angular.module("proton.controllers.Conversations", ["proton.constants"])

.controller('ConversationsController', function(
    $q,
    $log,
    $rootScope,
    $scope,
    $state,
    $stateParams,
    $timeout,
    $translate,
    $filter,
    $window,
    CONSTANTS,
    Conversation,
    Message,
    Label,
    authentication,
    cache,
    preloadConversation,
    confirmModal,
    cacheCounters,
    networkActivityTracker,
    notify,
    tools
) {
    var lastChecked = null;

    $scope.initialization = function() {
        // Variables
        $scope.mailbox = tools.currentMailbox();
        $scope.conversationsPerPage = authentication.user.NumMessagePerPage;
        $scope.labels = authentication.user.Labels;
        $scope.messageButtons = authentication.user.MessageButtons;
        $scope.Math = window.Math;
        $scope.CONSTANTS = CONSTANTS;
        $scope.selectedFilter = $stateParams.filter;
        $scope.selectedOrder = $stateParams.sort || "-date";
        $scope.page = parseInt($stateParams.page || 1);
        $scope.allSelectedCheckbox = false;
        $scope.startWatchingEvent();
        $scope.mobileResponsive();
        networkActivityTracker.track($scope.refreshConversations().then(function() {
            $scope.$watch('conversations', function(newValue, oldValue) {
                preloadConversation.set(newValue);
                $rootScope.numberSelectedMessages = $scope.elementsSelected().length;
            }, true);
            $timeout($scope.actionsDelayed); // If we don't use the timeout, messages seems not available (to unselect for example)
            // I consider this trick like a bug in the angular application
        }, function(error) {
            $log.error(error);
        }));
    };

    $scope.mobileResponsive = function() {
        if ($window.outerWidth < 1024) {
            $rootScope.layoutMode = 'rows';
        }
    };

    $scope.startWatchingEvent = function() {
        angular.element($window).bind('resize', $scope.mobileResponsive);

        $scope.$on('refreshConversations', function() {
            $scope.refreshConversations();
        });

        $scope.$on('unactiveConversations', function() {
            $scope.unactiveConversations();
        });

        $scope.$on('updateLabels', function() {
            $scope.updateLabels();
        });

        $scope.$on('goToFolder', function(event) {
            $scope.unselectAllConversations();
        });

        $scope.$on('unselectAllConversations', function(event) {
            $scope.unselectAllConversations();
        });

        $scope.$on('discardDraft', function(event, id) {
            $scope.discardDraft(id);
        });

        $scope.$on('applyLabels', function(event, LabelID) {
            $scope.applyLabels(LabelID);
        });

        $scope.$on('move', function(event, name) {
            $scope.move(name);
        });

        $scope.$on('activeConversation', function(event, id) {
            $scope.activeConversation(id);
        });

        // $scope.$on('starMessages', function(event) {
        //     var ids = $scope.idsSelected();
        //     var promise;
        //
        //     _.each($scope.elementsSelected(), function(message) { message.Starred = 1; });
        //     promise = Message.star({IDs: ids}).$promise;
        //     networkActivityTracker.track(promise);
        //     $scope.unselectAllConversations();
        // });

        $scope.$on('$destroy', $scope.stopWatchingEvent);
    };

    $scope.stopWatchingEvent = function() {
        preloadConversation.reset();
        angular.element($window).unbind('resize', $scope.mobileResponsive);
    };

    $scope.actionsDelayed = function() {
        $scope.unselectAllConversations();
        $('#page').val($scope.page);
        $('#page').change(function(event) {
            $scope.goToPage();
        });

        if($rootScope.scrollPosition) {
            $('#content').scrollTop($rootScope.scrollPosition);
            $rootScope.scrollPosition = null;
        }
    };

    $scope.selectPage = function(page) {
        $scope.goToPage(page, page < $scope.page);
    };

    $scope.conversationCount = function() {
        var result;

        if(angular.isDefined($stateParams.filter) || $state.is('secured.search')) {
            result = $rootScope.Total;
        } else {
            switch($scope.mailbox) {
                case 'drafts':
                case 'sent':
                    result = cacheCounters.total(CONSTANTS.MAILBOX_IDENTIFIERS[$scope.mailbox]);
                    break;
                case 'label':
                    result = cacheCounters.conversation($stateParams.label);
                    break;
                default:
                    result = cacheCounters.conversation(CONSTANTS.MAILBOX_IDENTIFIERS[$scope.mailbox]);
                    break;
            }
        }

        return result;
    };

    $scope.makeDropdownPages = function() {
        var ddp = [];
        var ddp2 = [];
        var makeRangeCounter = 0;
        var count = $scope.conversationCount();

        for (var i = 0; i <= parseInt(count - 1); i++) {
            ddp[i] = i;
        }

        function makeRange(element, index, array) {
            if(index%CONSTANTS.MESSAGES_PER_PAGE === 0) {
                ddp2.push((index+1) + ' - ' + (index+CONSTANTS.MESSAGES_PER_PAGE));
                makeRangeCounter++;
            }
        }

        ddp.forEach(makeRange);

        return ddp2;
    };

    $scope.getConversationsParameters = function(mailbox) {
        var params = {};

        params.Page = ($stateParams.page || 1) - 1;

        if ($stateParams.filter) {
            params.Unread = +($stateParams.filter === 'unread');
        }

        if ($stateParams.sort) {
            var sort = $stateParams.sort;
            var desc = _.string.startsWith(sort, "-");

            if (desc) {
                sort = sort.slice(1);
            }

            params.Sort = _.string.capitalize(sort);
            params.Desc = +desc;
        }

        if (mailbox === 'search') {
            params.Location = $stateParams.location;
            params.Keyword = $stateParams.words;
            params.To = $stateParams.to;
            params.From = $stateParams.from;
            params.Subject = $stateParams.subject;
            params.Begin = $stateParams.begin;
            params.End = $stateParams.end;
            params.Attachments = $stateParams.attachments;
            params.Starred = $stateParams.starred;
            params.Label = $stateParams.label;
        } else if(mailbox === 'label') {
            params.Label = $stateParams.label;
        } else {
            params.Location = CONSTANTS.MAILBOX_IDENTIFIERS[mailbox];
        }

        if(parseInt(params.Location) === CONSTANTS.MAILBOX_IDENTIFIERS.starred) {
            params.Starred = 1;
            delete params.Location;
        }

        _.pick(params, _.identity);

        return params;
    };

    $scope.refreshConversations = function() {
        var deferred = $q.defer();
        var request = $scope.getConversationsParameters($scope.mailbox);
        var promise;
        var context = tools.cacheContext(request);

        if(['sent', 'drafts', 'search'].indexOf(tools.currentMailbox()) !== -1) {
            promise = cache.queryMessages(request);
        } else {
            promise = cache.queryConversations(request);
        }

        promise.then(function(conversations) {
            $scope.conversations = conversations;
            deferred.resolve(conversations);
        }, function(error) {
            notify({message: 'Error during quering conversations', classes: 'notification-danger'}); // TODO translate
            $log.error(error);
        });

        if(context === false) {
            networkActivityTracker.track(promise);
        }

        return deferred.promise;
    };

    $scope.unactiveConversations = function() {
        _.each($scope.conversations, function(conversation) {
            conversation.Active = false;
        });
    };

    $scope.activeConversation = function(id) {
        _.each($scope.conversations, function(conversation) {
            conversation.Active = angular.isDefined(id) && conversation.ID === id;
        });
    };

    $scope.updateLabels = function () {
        $scope.labels = authentication.user.Labels;
    };

    $scope.senderIsMe = function(message) {
        var result = false;

        for( var i = 0, len = $scope.user.Addresses.length; i < len; i++ ) {
            if( $scope.user.Addresses[i].Email === message.Sender.Address ) {
                result = true;
            }
        }

        return result;
    };

    $scope.getColorLabel = function(id) {
        return {
            color: $scope.getLabel(id).Color,
            borderColor: $scope.getLabel(id).Color
        };
    };

    $scope.start = function() {
        return ($scope.page - 1) * $scope.conversationsPerPage + 1;
    };

    $scope.end = function() {
        var end = $scope.start() + $scope.conversationsPerPage - 1;

        if (end > $scope.conversationCount()) {
            end = $scope.conversationCount();
        }

        return end;
    };

    $scope.hasNextPage = function() {
        return $scope.conversationCount() > ($scope.page * $scope.conversationsPerPage);
    };

    $scope.allSelected = function() {
        var status = true;

        if ($scope.conversations && $scope.conversations.length > 0) {
            _.forEach($scope.conversations, function(conversation) {
                if (!!!conversation.Selected) {
                    status = false;
                }
            });
        } else {
            status = false;
        }

        $scope.allSelectedCheckbox = status;
    };

    $scope.toggleAllSelected = function() {
        var status = $scope.allSelectedCheckbox;

        if(status === true) {
            $scope.unselectAllConversations();
        } else {
            $scope.selectAllMessages();
        }
    };

    $scope.selectAllMessages = function() {
        _.each($scope.conversations, function(conversation) {
            conversation.Selected = true;
        });

        $scope.allSelectedCheckbox = true;
    };

    $scope.unselectAllConversations = function() {
        _.each($scope.conversations, function(conversations) {
            conversations.Selected = false;
        });

        $scope.allSelectedCheckbox = false;
    };

    $scope.elementsSelected = function() {
        return _.where($scope.conversations, {Selected: true});
    };

    $scope.idsSelected = function() {
        return _.map($scope.elementsSelected(), function(conversation) { return conversation.ID; });
    };

    /**
     * Mark conversations selected as read
     */
    $scope.read = function() {
        var ids = $scope.idsSelected();
        var elements = angular.copy($scope.elementsSelected());
        var conversationEvent = [];
        var messageEvent = [];
        var type = tools.typeList();

        // cache
        _.each(elements, function(element) {
            element.NumUnread = 0;

            if(type === 'conversation') {
                var messages = cache.queryMessagesCached(element.ID);

                conversationEvent.push({Action: 3, ID: element.ID, Conversation: element});

                if(messages.length > 0) {
                    _.each(messages, function(message) {
                        message.IsRead = 1;
                        messageEvent.push({Action: 3, ID: message.ID, Message: message});
                    });
                }
            } else if(type === 'message') {
                messageEvent.push({Action: 3, ID: element.ID, Message: element});
            }
        });

        cache.events(conversationEvent, 'conversation');
        cache.events(messageEvent, 'message');

        // api
        if(type === 'conversation') {
            Conversation.read(ids);
        } else if (type === 'message') {
            Message.read({IDs: ids});
        }

        $scope.unselectAllConversations();
    };

    /**
     * Mark conversations selected as unread
     */
    $scope.unread = function() {
        var ids = $scope.idsSelected();
        var elements = angular.copy($scope.elementsSelected());
        var conversationEvent = [];
        var messageEvent = [];
        var type = tools.typeList();

        // cache
        _.each(elements, function(element) {
            element.NumUnread = 1;

            if(type === 'conversation') {
                var messages = cache.queryMessagesCached(element.ID);

                conversationEvent.push({Action: 3, ID: element.ID, Conversation: element});

                if(messages.length > 0) {
                    var last = _.last(messages); // Unread only the latest

                    last.IsRead = 0;
                    messageEvent.push({Action: 3, ID: last.ID, Message: last});
                }
            } else if(type === 'message') {
                messageEvent.push({Action: 3, ID: element.ID, Message: element});
            }
        });

        cache.events(conversationEvent, 'conversation');
        cache.events(messageEvent, 'message');

        // api
        if(type === 'conversation') {
            Conversation.unread(ids);
        } else if (type === 'message') {
            Message.unread({IDs: ids});
        }

        $scope.unselectAllConversations();
    };

    /**
     * Delete elements selected
     */
    $scope.delete = function() {
        var ids = $scope.idsSelected();
        var elements = angular.copy($scope.elementsSelected());
        var conversationEvent = [];
        var messageEvent = [];
        var type = tools.typeList();

        // cache
        _.each(elements, function(element) {
            if(type === 'conversation') {
                var messages = cache.queryMessagesCached(element.ID);

                conversationEvent.push({Action: 0, ID: element.ID, Conversation: element});

                if(messages.length > 0) {
                    _.each(messages, function(message) {
                        messageEvent.push({Action: 0, ID: message.ID, Message: message});
                    });
                }
            } else if(type === 'message') {
                messageEvent.push({Action: 0, ID: element.ID, Message: element});
                // Manage the case where the message is open in the composer
                $rootScope.$broadcast('deleteMessage', element.ID);
            }
        });

        cache.events(conversationEvent, 'conversation');
        cache.events(messageEvent, 'message');

        // api
        if(type === 'conversation') {
            Conversation.delete(ids);
        } else if (type === 'message') {
            Message.delete({IDs: ids});
        }

        $scope.unselectAllConversations();
    };

    /**
     * Move conversation to an other location
     * @param {String} mailbox
     */
    $scope.move = function(mailbox) {
        var ids = $scope.idsSelected();
        var elements = angular.copy($scope.elementsSelected());
        var conversationEvent = [];
        var messageEvent = [];
        var type = tools.typeList();

        // Cache
        _.each(elements, function(element) {
            var currents = [];

            // Find current location
            _.each(element.LabelIDs, function(labelID) {
                if(['0', '1', '2', '3', '4', '6'].indexOf(labelID) !== -1) {
                    currents.push(labelID.toString());
                }
            });

            element.LabelIDsRemoved = currents; // Remove currents location
            element.LabelIDsAdded = [CONSTANTS.MAILBOX_IDENTIFIERS[mailbox]]; // Add new location

            if(type === 'conversation') {
                var messages = cache.queryMessagesCached(element.ID);

                conversationEvent.push({Action: 3, ID: element.ID, Conversation: element});

                if(messages.length > 0) {
                    _.each(messages, function(message) {
                        message.LabelIDsRemoved = currents; // Remove currents location
                        message.LabelIDsAdded = [CONSTANTS.MAILBOX_IDENTIFIERS[mailbox]]; // Add new location
                        messageEvent.push({Action: 3, ID: message.ID, Message: message});
                    });
                }
            } else if(type === 'message') {
                messageEvent.push({Action: 3, ID: element.ID, Message: element});
            }
        });

        // Unselect elements
        $scope.unselectAllConversations();

        // Send events
        cache.events(conversationEvent, 'conversation');
        cache.events(messageEvent, 'message');

        // Request
        if(type === 'conversation') {
            Conversation[mailbox](ids);
        } else if (type === 'message') {
            Message[mailbox]({IDs: ids});
        }
    };

    /**
     * Move draft message to trash
     * @param {String} id - message id
     */
    $scope.discardDraft = function(id) {
        var events = [];

        // Manage cache
        events.push({
            Action: 3,
            ID: id,
            Message: {
                ID: id,
                LabelIDsAdded: [CONSTANTS.MAILBOX_IDENTIFIERS.trash],
                LabelIDsRemoved: [CONSTANTS.MAILBOX_IDENTIFIERS.drafts]
            }
        });

        cache.events(events, 'message');

        // Request
        Message.trash({IDs: [id]});
    };

    $scope.unselectAllLabels = function() {
        _.forEach($scope.labels, function(label) {
            label.Selected = false;
        });
    };

    $scope.closeLabels = function() {
        $scope.unselectAllLabels();
        $('[data-toggle="dropdown"]').parent().removeClass('open');
    };

    $scope.saveLabels = function(labels, alsoArchive) {
        var REMOVE = 0;
        var ADD = 1;
        var deferred = $q.defer();
        var ids = $scope.idsSelected();
        var toApply = _.map(_.where(labels, {Selected: true}), function(label) { return label.ID; });
        var toRemove = _.map(_.where(labels, {Selected: false}), function(label) { return label.ID; });
        var promises = [];
        var elementsSelected = $scope.elementsSelected();
        var type = tools.typeList();
        var conversationEvent = [];
        var messageEvent = [];

        _.each(toApply, function(labelID) {
            if(type === 'conversation') {
                promises.push(Conversation.labels(labelID, ADD, ids));
            } else if(type === 'message') {
                promises.push(Label.apply({id: labelID, MessageIDs: ids}).$promise);
            }
        });

        _.each(toRemove, function(labelID) {
            if(type === 'conversation') {
                promises.push(Conversation.labels(labelID, REMOVE, ids));
            } else if(type === 'message') {
                promises.push(Label.remove({id: labelID, MessageIDs: ids}).$promise);
            }
        });

        _.each(elementsSelected, function(element) {
            var copy = angular.copy(element);
            var currents = [];

            // Find current location
            _.each(copy.LabelIDs, function(labelID) {
                if(['0', '1', '2', '3', '4', '6'].indexOf(labelID) !== -1) {
                    currents.push(labelID.toString());
                }
            });

            if(alsoArchive === true) {
                toApply.push(CONSTANTS.MAILBOX_IDENTIFIERS.archive);
                toRemove.concat(currents);
            }

            copy.LabelIDsAdded = toApply;
            copy.LabelIDsRemoved = toRemove;

            if(type === 'conversation') {
                var messages = cache.queryMessagesCached(copy.ID);

                conversationEvent.push({Action: 3, ID: copy.ID, Conversation: copy});

                _.each(messages, function(message) {
                    message.LabelIDsAdded = toApply;
                    message.LabelIDsRemoved = toRemove;
                    messageEvent.push({Action: 3, ID: message.ID, Message: message});
                });
            } else if (type === 'message') {
                messageEvent.push({Action: 3, ID: copy.ID, Message: copy});
            }
        });

        cache.events(conversationEvent, 'conversation');
        cache.events(messageEvent, 'message');

        $q.all(promises).then(function(results) {
            if(alsoArchive === true) {
                deferred.resolve(Conversation.archive(ids));
            } else {
                $scope.unselectAllConversations();
                deferred.resolve();
            }

            $scope.unselectAllLabels();
        }, function(error) {
            error.message = $translate.instant('ERROR_DURING_THE_LABELS_REQUEST');
            deferred.reject(error);
        });

        return deferred.promise;
    };

    $scope.applyLabels = function(LabelID) {
        var labels = [];

        _.each($scope.labels, function(label) {
            if(label.ID === LabelID) {
                label.Selected = true;
            }

            labels.push(label);
        });

        $scope.saveLabels(labels, true);
    };

    $scope.goToPage = function(page, scrollToBottom) {
        $rootScope.scrollToBottom = scrollToBottom === true;
        $scope.unselectAllConversations();
        $scope.page = page;
        if (page > 0 && $scope.conversationCount() > ((page - 1) * $scope.conversationsPerPage)) {
            if (page === 1) {
                page = undefined;
            }

            $state.go($state.current.name, _.extend({}, $state.params, {
                page: page,
                id: undefined
            }));
        }
    };

    /**
     * Return conversations selected
     * @return {Array}
     */
    var elementsSelected = function() {
        return _.where($scope.conversations, {Selected: true});
    };

    /**
     * Return conversations id selected
     * @return {Array}
     */
    var idsSelected = function() {

    };

    $scope.showTo = function(message) {
        return (
            $scope.senderIsMe(message) &&
            (
                !$state.is('secured.inbox.list') &&
                !$state.is('secured.archive.list')  &&
                !$state.is('secured.spam.list')  &&
                !$state.is('secured.trash.list')
            )
        ) ? true : false;
    };

    $scope.showFrom = function(message) {
        return ((
                !$state.is('secured.inbox.list') &&
                !$state.is('secured.drafts.list')  &&
                !$state.is('secured.archive.list') &&
                !$state.is('secured.sent.list') &&
                !$state.is('secured.spam.list') &&
                !$state.is('secured.trash.list')
            )
        ) ? true : false;
    };

    /**
     * Toggle star
     * @param {Object} element - conversation or message
     */
    $scope.toggleStar = function(element) {
        if($scope.starred(element) === true) {
            $scope.unstar(element);
        } else {
            $scope.star(element);
        }
    };

    /**
     * Star conversation or message
     * @param {Object} element
     */
    $scope.star = function(element) {
        var conversationEvent = [];
        var messageEvent = [];
        var copy = angular.copy(element);
        var type = tools.typeList();

        copy.LabelIDsAdded = [CONSTANTS.MAILBOX_IDENTIFIERS.starred];

        if(type === 'conversation') {
            var messages = cache.queryMessagesCached(copy.ID);
            // Generate conversation changes with event
            conversationEvent.push({ID: copy.ID, Action: 2, Conversation: copy});
            cache.events(conversationEvent, 'conversation');
            // Generate message changes with event
            if(messages.length > 0) {
                _.each(messages, function(message) {
                    message.LabelIDsAdded = [CONSTANTS.MAILBOX_IDENTIFIERS.starred];
                    messageEvent.push({ID: message.ID, Action: 3, Message: message});
                });
                cache.events(messageEvent, 'message');
            }
            // Send request
            Conversation.star([copy.ID]);
        } else if(type === 'message') {
            messageEvent.push({ID: copy.ID, Action: 3, Message: copy});
            cache.events(messageEvent, 'message');
            // Send request
            Message.star({IDs: [copy.ID]});
        }
    };

    /**
     * Unstar conversation or message
     * @param {Object} element
     */
    $scope.unstar = function(element) {
        var conversationEvent = [];
        var messageEvent = [];
        var copy = angular.copy(element);
        var type = tools.typeList();

        copy.LabelIDsRemoved = [CONSTANTS.MAILBOX_IDENTIFIERS.starred];

        if(type === 'conversation') {
            var messages = cache.queryMessagesCached(copy.ID);
            // Generate conversation changes with event
            conversationEvent.push({ID: copy.ID, Action: 2, Conversation: copy});
            cache.events(conversationEvent, 'conversation');
            // Generate message changes with event
            if(messages.length > 0) {
                _.each(messages, function(message) {
                    message.LabelIDsRemoved = [CONSTANTS.MAILBOX_IDENTIFIERS.starred];
                    messageEvent.push({ID: message.ID, Action: 3, Message: message});
                });
                cache.events(messageEvent, 'message');

            }
            // Send request
            Conversation.unstar([copy.ID]);
        } else if(type === 'message') {
            messageEvent.push({ID: copy.ID, Action: 3, Message: copy});
            cache.events(messageEvent, 'message');
        }

        if(type === 'conversation') {
        } else if(type === 'message') {
            Message.unstar({IDs: [copy.ID]});
        }
    };

    /**
     * Check in LabelIDs to see if the conversation or message is starred
     */
    $scope.starred = function(element) {
        if(element.LabelIDs.indexOf(CONSTANTS.MAILBOX_IDENTIFIERS.starred) !== -1) {
            return true;
        } else {
            return false;
        }
    };

    /**
     * Return label object
     * @param {String} id
     */
    $scope.getLabel = function(id) {
        return _.findWhere(authentication.user.Labels, {ID: id});
    };

    /**
     * Return style for label element
     * @param {String} id
     */
    $scope.getStyleLabel = function(id) {
        return {
            color: $scope.getLabel(id).Color,
            borderColor: $scope.getLabel(id).Color
        };
    };

    /**
     * On click on a conversation
     * @param {Object} element - Conversation or Message
     */
    $scope.click = function(element) {
        var type = tools.typeList();

        delete $rootScope.openMessage;
        // Save scroll position
        $rootScope.scrollPosition = $('#content').scrollTop();
        // Open conversation
        if(type === 'conversation') {
            $state.go('secured.' + $scope.mailbox + '.list.view', { id: element.ID });
        } else if (type === 'message') {
            $rootScope.openMessage = [element.ID];
            $state.go('secured.' + $scope.mailbox + '.list.view', { id: element.ConversationID });
        }
    };

    /**
     * On select a conversation
     * @param {Object} event
     * @param {Object} conversation
     */
    $scope.select = function(event, conversation) {
        if(!lastChecked) {
            lastChecked = conversation;
        } else {
            if (event, event.shiftKey) {
                var start = _.indexOf($scope.conversations, conversation);
                var end = _.indexOf($scope.conversations, lastChecked);

                _.each($scope.conversations.slice(Math.min(start, end), Math.max(start, end) + 1), function(conversation) {
                    conversation.Selected = true;
                });
            }

            lastChecked = conversation;
        }

        // $scope.allSelected();
    };

    /**
     * Filter current list
     * @param {String}
     */
    $scope.filterBy = function(status) {
        $state.go($state.current.name, _.extend({}, $state.params, {
            filter: status,
            page: undefined
        }));
    };

    /**
     * Clear current filter
     */
    $scope.clearFilter = function() {
        $state.go($state.current.name, _.extend({}, $state.params, {
            filter: undefined,
            page: undefined
        }));
    };

    $scope.orderBy = function(criterion) {
        $state.go($state.current.name, _.extend({}, $state.params, {
            sort: criterion === '-date' ? undefined : criterion,
            page: undefined
        }));
    };

    $scope.emptyFolder = function(location) {
        var title = $translate.instant('CONFIRMATION');
        var message = $translate.instant('ARE_YOU_SURE?') + ' ' + $translate.instant('THIS_CANNOT_BE_UNDONE.');
        var promise;

        confirmModal.activate({
            params: {
                title: title,
                message: message,
                confirm: function() {
                    if (parseInt(location) === CONSTANTS.MAILBOX_IDENTIFIERS.drafts) {
                        promise = Message.emptyDraft().$promise;
                    } else if (parseInt(location) === CONSTANTS.MAILBOX_IDENTIFIERS.spam) {
                        promise = Message.emptySpam().$promise;
                    } else if (parseInt(location) === CONSTANTS.MAILBOX_IDENTIFIERS.trash) {
                        promise = Message.emptyTrash().$promise;
                    }

                    promise.then(
                        function(result) {
                            cache.clearLocation(location);
                            cacheCounters.empty(location);
                            $rootScope.$broadcast('refreshCounters');
                            $rootScope.$broadcast('refreshConversations');
                            notify({message: $translate.instant('FOLDER_EMPTIED'), classes: 'notification-success'});
                        },
                        function(error) {
                            notify({message: 'Error during the empty request', classes: 'notification-danger'});
                            $log.error(error);
                        }
                    );

                    confirmModal.deactivate();
                },
                cancel: function() {
                    confirmModal.deactivate();
                }
            }
        });
    };

    $scope.initialization();
});

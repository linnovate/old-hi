/*
 * ROOM VIEW
 * TODO: Break it up :/
 */

'use strict';

+function(window, $, _) {

    window.LCB = window.LCB || {};

    window.LCB.RoomView = Backbone.View.extend({
        events: {
            'scroll .lcb-messages': 'updateScrollLock',
            'keypress .lcb-entry-input': 'sendMessage',
            'click .lcb-entry-button': 'sendMessage',
            'DOMCharacterDataModified .lcb-room-heading, .lcb-room-description': 'sendMeta',
            'click .lcb-room-toggle-sidebar': 'toggleSidebar',
            'click .show-edit-room': 'showEditRoom',
            'click .hide-edit-room': 'hideEditRoom',
            'click .submit-edit-room': 'submitEditRoom',
            'click .archive-room': 'archiveRoom',
            //'click .lcb-room-poke': 'poke',
            'click .lcb-room-poke': 'directMessage',
            'click .lcb-upload-trigger': 'upload'
        },
        initialize: function(options) {
            this.client = options.client;

            var iAmOwner = this.model.get('owner') === this.client.user.id;
            var iCanEdit = iAmOwner || ($.inArray(this.client.user.get('username'),this.model.get('superusers'))!== -1);

            this.model.set('iAmOwner', iAmOwner);
            this.model.set('iCanEdit', iCanEdit);
            this.model.set('inIframe', this.client.options.iframe);
            
            
            this.template = options.template;
            this.messageTemplate =
                Handlebars.compile($('#template-message').html());
            this.render();
            this.model.on('messages:new', this.addMessage, this);
            this.model.on('change', this.updateMeta, this);
            this.model.on('remove', this.goodbye, this);
            this.model.users.on('change', this.updateUser, this);

            //
            // Subviews
            //
            this.usersList = new window.LCB.RoomUsersView({
                el: this.$('.lcb-room-sidebar-users'),
                collection: this.model.users
            });
            this.filesList = new window.LCB.RoomFilesView({
                el: this.$('.lcb-room-sidebar-files'),
                collection: this.model.files
            });
        },
        render: function() {
            this.$el = $(this.template(_.extend(this.model.toJSON(), {
                sidebar: store.get('sidebar')
            })));
            this.$messages = this.$('.lcb-messages');
            // Scroll Locking
            this.scrollLocked = true;
            this.$messages.on('scroll',  _.bind(this.updateScrollLock, this));
            this.atwhoMentions();
            this.atwhoAllMentions();
            this.atwhoRooms();
            this.atwhoEmotes();
            
            this.attachSelectize('.lcb-entry-participants');
            this.attachSelectize('.lcb-entry-superusers');
        },
        atwhoTplEval: function(tpl, map) {
            var error;
            try {
                return tpl.replace(/\$\{([^\}]*)\}/g, function(tag, key, pos) {
                    return (map[key] || '')
                        .replace(/&/g, '&amp;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&apos;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                });
            } catch (_error) {
                error = _error;
                return "";
            }
        },
        getAtwhoUserFilter: function(collection) {
            var currentUser = this.client.user;

            return function filter(query, data, searchKey) {
                var q = query.toLowerCase();
                var results = collection.filter(function(user) {
                    var attr = user.attributes;

                    if (user.id === currentUser.id) {
                        return false;
                    }

                    if (!attr.safeName) {
                        attr.safeName = attr.displayName.replace(/\W/g, '');
                    }

                    var val1 = attr.username.toLowerCase();
                    var val1i = val1.indexOf(q);
                    if (val1i > -1) {
                        attr.atwho_order = val1i;
                        return true;
                    }

                    var val2 = attr.safeName.toLowerCase();
                    var val2i = val2.indexOf(q);
                    if (val2i > -1) {
                        attr.atwho_order = val2i + attr.username.length;
                        return true;
                    }

                    return false;
                });

                return results.map(function(user) {
                    return user.attributes;
                });
            };
        },
        atwhoMentions: function () {

            function sorter(query, items, search_key) {
                return items.sort(function(a, b) {
                    return a.atwho_order - b.atwho_order;
                });
            }
            var options = {
                at: '@',
                tpl: '<li data-value="@${username}"><img src="/users/${username}/avatar?s=20" height="20" width="20" /> @${username} <small>${displayName}</small></li>',
                callbacks: {
                    filter: this.getAtwhoUserFilter(this.model.users),
                    sorter: sorter,
                    tpl_eval: this.atwhoTplEval
                }
            };

            this.$('.lcb-entry-input').atwho(options);
        },
        atwhoAllMentions: function () {
            var that = this;

            function filter(query, data, searchKey) {
                var users = that.client.getUsersSync();
                var filt = that.getAtwhoUserFilter(users);
                return filt(query, data, searchKey);
            }

            function sorter(query, items, search_key) {
                return items.sort(function(a, b) {
                    return a.atwho_order - b.atwho_order;
                });
            }

            var options = {
                at: '@@',
                tpl: '<li data-value="@${username}"><img src="/users/${username}/avatar?s=20" height="20" width="20" /> @${username} <small>${displayName}</small></li>',
                callbacks: {
                    filter: filter,
                    sorter: sorter,
                    tpl_eval: that.atwhoTplEval
                }
            };

            //changed by jo for current version in order to prevent sending message to person that isn't room member
            //this.$('.lcb-entry-input').atwho(options);

            var opts = _.extend(options, { at: '@'});
            this.$('.lcb-entry-participants').atwho(opts);
            this.$('.lcb-room-participants').atwho(opts);
            this.$('.lcb-entry-superusers').atwho(opts);
            this.$('.lcb-room-superusers').atwho(opts);
        },
        attachSelectize: function (textareaElement) {
            var that = this;

            this.$(textareaElement).selectize({
                delimiter: ',',
                create: false,
                load: function(query, callback) {
                    if (!query.length) return callback();

                    var users = that.client.getUsersSync();

                    var usernames = users.map(function(user) {
                        return user.attributes.username;
                    });

                    usernames = _.filter(usernames, function(username) {
                        return username.indexOf(query) !== -1;
                    });

                    users = _.map(usernames, function(username) {
                        return {
                            value: username,
                            text: username
                        };
                    });

                    callback(users);
                }
            });
        },
        atwhoRooms: function() {
            var rooms = this.client.rooms;

            function filter(query, data, searchKey) {
                var q = query.toLowerCase();
                var results = rooms.filter(function(room) {
                    var val = room.attributes.slug.toLowerCase();
                    return val.indexOf(q) > -1;
                });

                return results.map(function(room) {
                    return room.attributes;
                });
            }

            this.$('.lcb-entry-input')
                .atwho({
                    at: '#',
                    search_key: 'slug',
                    callbacks: {
                        filter: filter,
                        tpl_eval: this.atwhoTplEval
                    },
                    tpl: '<li data-value="#${slug}">#${slug} <small>${name}</small></li>'
                });
        },
        atwhoEmotes: function() {
            var that = this;
            this.client.getEmotes(function(emotes) {
                that.$('.lcb-entry-input')
                .atwho({
                    at: ':',
                    search_key: 'emote',
                    data: emotes,
                    tpl: '<li data-value=":${emote}:"><img src="${image}" height="32" width="32" alt=":${emote}:" /> :${emote}:</li>'
                });
            });
        },
        goodbye: function() {
            swal('Archived!', '"' + this.model.get('name') + '" has been archived.', 'warning');
        },
        updateMeta: function() {
            this.$('.lcb-room-heading .name').text(this.model.get('name'));
            this.$('.lcb-room-heading .slug').text('#' + this.model.get('slug'));
            this.$('.lcb-room-description').text(this.model.get('description'));
            this.$('.lcb-room-participants').text(this.model.get('participants'));
            this.$('.lcb-room-superusers').text(this.model.get('superusers'));
        },
        sendMeta: function(e) {
            this.model.set({
                name: this.$('.lcb-room-heading').text(),
                description: this.$('.lcb-room-description').text(),
                participants: this.$('.lcb-room-participants').text(),
                superusers: this.$('.lcb-room-superusers').text()
            });
            this.client.events.trigger('rooms:update', {
                id: this.model.id,
                name: this.model.get('name'),
                description: this.model.get('description'),
                participants: this.model.get('participants'),
                superusers: this.model.get('superusers')
            });
        },
        showEditRoom: function(e) {
            if (e) {
                e.preventDefault();
            }

            var $modal = this.$('.lcb-room-edit'),
                $name = $modal.find('input[name="name"]'),
                $description = $modal.find('textarea[name="description"]'),
                $password = $modal.find('input[name="password"]'),
                $confirmPassword = $modal.find('input[name="confirmPassword"]'),
                $participantsTextarea = $modal.find('textarea[name="participants"]'),
                $superusersTextarea = $modal.find('textarea[name="superusers"]');

            $name.val(this.model.get('name'));
            $description.val(this.model.get('description'));
            $password.val('');
            $confirmPassword.val('');

            // Build the options for selectize so addItems will work properly
            if($participantsTextarea.length != 0) {
                var participants = this.model.get('participants');
                var superusers = this.model.get('superusers');
                var participantsOptions = [];
                var superusersOptions = [];

                for (var i = 0; i < participants.length; i++) {
                    participantsOptions.push({text: participants[i], value: participants[i]});
                }

                for (var j = 0; j < superusers.length; j++) {
                    superusersOptions.push({text: superusers[j], value: superusers[j]});
                }

                $participantsTextarea[0].selectize.clear();
                $superusersTextarea[0].selectize.clear();
                $participantsTextarea[0].selectize.addOption(participantsOptions);
                $superusersTextarea[0].selectize.addOption(superusersOptions);
                $participantsTextarea[0].selectize.addItems(participants);
                $superusersTextarea[0].selectize.addItems(superusers);
            }

            $modal.modal();
        },
        hideEditRoom: function(e) {
            if (e) {
                e.preventDefault();
            }
            this.$('.lcb-room-edit').modal('hide');
        },
        submitEditRoom: function(e) {
            if (e) {
                e.preventDefault();
            }

            var $modal = this.$('.lcb-room-edit'),
                $name = $modal.find('input[name="name"]'),
                $description = $modal.find('textarea[name="description"]'),
                $password = $modal.find('input[name="password"]'),
                $confirmPassword = $modal.find('input[name="confirmPassword"]'),
                $participants =
                    this.$('.edit-room textarea[name="participants"]'),
                $superusers = this.$('.edit-room textarea[name="superusers"]');

            $name.parent().removeClass('has-error');
            $confirmPassword.parent().removeClass('has-error');

            if (!$name.val()) {
                $name.parent().addClass('has-error');
                return;
            }

            if ($password.val() && $password.val() !== $confirmPassword.val()) {
                $confirmPassword.parent().addClass('has-error');
                return;
            }

            this.client.events.trigger('rooms:update', {
                id: this.model.id,
                name: $name.val(),
                description: $description.val(),
                password: $password.val(),
                participants: $participants.val(),
                superusers: $superusers.val()
            });

            $modal.modal('hide');
        },
        archiveRoom: function(e) {
            if (this.model.attributes.owner != window.client.user.id){
                swal('Error archiving room', 'Only owner can archive room.');
            }
            else{
                var that = this;
                swal({
                    title: 'Archive "' +
                        this.model.get('name') + '"?',
                    text: "You will not be able to open it!",
                    type: "error",
                    confirmButtonText: "Archive",
                    allowOutsideClick: false,
                    confirmButtonColor: "#D32F2F",
                    showCancelButton: true,
                    closeOnConfirm: true,
                }, function(isConfirm) {
                    if (isConfirm) {
                        that.$('.lcb-room-edit').modal('hide');
                        that.client.events.trigger('rooms:archive', {
                            room: that.model.id
                        });
                    }
                });
            }
            var that = this;
            swal({
                    title: 'Archive "' +
                        this.model.get('name') + '"?',
                    text: "You will not be able to open it!",
                    type: "error",
                    confirmButtonText: "Archive",
                    allowOutsideClick: true,
                    confirmButtonColor: "#D32F2F",
                    showCancelButton: true,
                    closeOnConfirm: true,
                }, function(isConfirm) {
                    if (isConfirm) {
                        that.$('.lcb-room-edit').modal('hide');
                        that.client.events.trigger('rooms:archive', {
                            room: that.model.id
                        });
                    }
                });
        },
        sendMessage: function(e) {
            if (e.type === 'keypress' && e.keyCode !== 13 || e.altKey) return;
            if (e.type === 'keypress' && e.keyCode === 13 && e.shiftKey) return;
            e.preventDefault();
            if (!this.client.status.get('connected')) return;
            var $textarea = this.$('.lcb-entry-input');
            if (!$textarea.val()) return;
            this.client.events.trigger('messages:send', {
                room: this.model.id,
                text: $textarea.val()
            });
            $textarea.val('');
            this.scrollLocked = true;
            this.scrollMessages();
        },
        addMessage: function(message) {
            // Smells like pasta
            message.paste = /\n/i.test(message.text);

            var posted = moment(message.posted);

            // Fragment or new message?
            message.fragment = this.lastMessageOwner === message.owner.id &&
                            posted.diff(this.lastMessagePosted, 'minutes') < 5;

            // Mine? Mine? Mine? Mine?
            message.own = this.client.user.id === message.owner.id;

            // WHATS MY NAME
            message.mentioned = new RegExp('\\B@(' + this.client.user.get('username') + '|all)(?!@)\\b', 'i').test(message.text);

            // Check if this is the first message to this date
            if ((this.lastMessagePosted == undefined) ||
                (this.lastMessagePosted.format("YYYY-MM-DD") !== posted.format("YYYY-MM-DD") && !message.fragment)) {
                message.isFirst = true;
            }

            // Templatin' time
            var $html = $(this.messageTemplate(message).trim());
            var $text = $html.find('.lcb-message-text');

            var that = this;
            this.formatMessage($text.html(), function(text) {
                $text.html(text);
                $html.find('time').text(posted.format("HH:mm"));
                that.$messages.append($html);
                that.lastMessageOwner = message.owner.id;
                that.lastMessagePosted = posted;
                that.scrollMessages();

                if (!message.historical) {
                    window.utils.eggs.message(message.text);
                }

                if (message.isFirst){
                    var strBeautDate = posted.format("LL");
                    var secondSpace = strBeautDate.lastIndexOf(" ");
                    strBeautDate = strBeautDate.slice(0, secondSpace) + ", " + strBeautDate.slice(secondSpace, strBeautDate.length);
                    $html.find('.lcb-date-text').text(strBeautDate);
                }
            });

        },
        formatMessage: function(text, cb) {
            var client = this.client;
            client.getEmotes(function(emotes) {
                client.getReplacements(function(replacements) {
                    var data = {
                        emotes: emotes,
                        replacements: replacements,
                        rooms: client.rooms
                    };

                    var msg = window.utils.message.format(text, data);
                    cb(msg);
                });
            });
        },
        updateScrollLock: function() {
            this.scrollLocked = this.$messages[0].scrollHeight -
              this.$messages.scrollTop() - 5 <= this.$messages.outerHeight();
            return this.scrollLocked;
        },
        scrollMessages: function(force) {
            if ((!force && !this.scrollLocked) || this.$el.hasClass('hide')) {
                return;
            }
            this.$messages[0].scrollTop = this.$messages[0].scrollHeight;
        },
        toggleSidebar: function(e) {
            e && e.preventDefault && e.preventDefault();
            // Target siblings too!
            this.$el.siblings('.lcb-room').andSelf().toggleClass('lcb-room-sidebar-opened');
            // Save to localstorage
            if ($(window).width() > 767) {
                this.scrollMessages();
                store.set('sidebar',
                          this.$el.hasClass('lcb-room-sidebar-opened'));
            }
        },
        destroy: function() {
            this.undelegateEvents();
            this.$el.removeData().unbind();
            this.remove();
            Backbone.View.prototype.remove.call(this);
        },
        poke: function(e) {
            var $target = $(e.currentTarget),
                $root = $target.closest('[data-id],[data-owner]'),
                id = $root.data('owner') || $root.data('id'),
                user = this.model.users.findWhere({
                    id: id
                });
            if (!user) return;
            var $input = this.$('.lcb-entry-input'),
                text = $.trim($input.val()),
                at = (text.length > 0 ? ' ' : '') + '@' + user.get('username') + ' '
            $input.val(text + at).focus();
        },
        directMessage: function(e){
          var $target = $(e.currentTarget),
              $root = $target.closest('[data-id],[data-owner]'),
              id = $root.data('owner') || $root.data('id'),
              user = this.model.users.findWhere({
                  id: id
              });
              if(!user) return;
              
              window.client.createDirectMessage(user);
        },
        upload: function(e) {
            e.preventDefault();
            this.model.trigger('upload:show', this.model);
        },
        updateUser: function(user) {
            var $messages = this.$('.lcb-message[data-owner="' + user.id + '"]');
            $messages.find('.lcb-message-username').text('@' + user.get('username'));
            $messages.find('.lcb-message-displayname').text(user.get('displayName'));
        }
    });

    window.LCB.RoomSidebarListView = Backbone.View.extend({
        initialize: function(options) {
            this.template = Handlebars.compile($(this.templateSelector).html());
            this.collection.on('add remove', function() {
                this.count();
            }, this);
            this.collection.on('add', function(model) {
                this.add(model.toJSON());
            }, this);
            this.collection.on('change', function(model) {
                this.update(model.toJSON());
            }, this);
            this.collection.on('remove', function(model) {
                this.remove(model.id);
            }, this);
            this.render();
        },
        render: function() {
            this.collection.each(function(model) {
                this.add(model.toJSON());
            }, this);
            this.count();
        },
        add: function(model) {
            this.$('.lcb-room-sidebar-list').prepend(this.template(model));
        },
        remove: function(id) {
            this.$('.lcb-room-sidebar-item[data-id=' + id + ']').remove();
        },
        count: function(models) {
            this.$('.lcb-room-sidebar-items-count').text(this.collection.length);
        },
        update: function(model){
            this.$('.lcb-room-sidebar-item[data-id=' + model.id + ']')
                .replaceWith(this.template(model));
        }
    });

    window.LCB.RoomUsersView = window.LCB.RoomSidebarListView.extend({
        templateSelector: '#template-user'
    });

    window.LCB.RoomFilesView = window.LCB.RoomSidebarListView.extend({
        templateSelector: '#template-file'
    });

}(window, $, _);

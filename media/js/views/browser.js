/*
 * BROWSER VIEW
 * This is the "All Rooms" browser!
 */

'use strict';

+function(window, $, _) {

    window.LCB = window.LCB || {};

    window.LCB.BrowserView = Backbone.View.extend({
        events: {
            'submit .lcb-rooms-add': 'create',
            'keyup .lcb-rooms-browser-filter-input': 'filter',
            'change .lcb-rooms-switch': 'toggle',
            'click .lcb-rooms-switch-label': 'toggle',
            'click #lcb-add-room [data-dismiss="modal"]': 'cancelRoomCreation',
            'click .lcb-room-alert': 'turnAlert'
        },
        initialize: function(options) {
            this.client = options.client;
            this.template = Handlebars.compile($('#template-room-browser-item').html());
            this.userTemplate = Handlebars.compile($('#template-room-browser-item-user').html());
            this.rooms = options.rooms;
            this.rooms.on('add', this.add, this);
            this.rooms.on('remove', this.remove, this);
            this.rooms.on('change:description change:name', this.update, this);
            this.rooms.on('change:lastActive', _.debounce(this.updateLastActive, 200), this);
            this.rooms.on('change:joined', this.updateToggles, this);
            this.rooms.on('users:add', this.addUser, this);
            this.rooms.on('users:remove', this.removeUser, this);
            this.rooms.on('users:add users:remove add remove', this.sort, this);
            this.rooms.current.on('change:id', function(current, id) {
                // We only care about the list pane
                if (id !== 'list') return;
                this.sort();
            }, this);

            this.attachSelectize('.lcb-new-room-participants');

            this.attachSelectize('.lcb-new-room-superusers');

            $('.modal-trigger').leanModal();
        },
        updateToggles: function(room, joined) {
            this.$('.lcb-rooms-switch[data-id=' + room.id + ']').prop('checked', joined);
        },
        togglePrivateRoom: function(e){
          if(!e.currentTarget.checked){
              $('.lcb-new-room-superusers').addClass('hide');
              $('.lcb-new-room-participants').addClass('hide');
          }
          else{
              $('.lcb-new-room-superusers').removeClass('hide');
              $('.lcb-new-room-participants').removeClass('hide');
          }
        },
        toggle: function(e) {
            e.preventDefault();
            var $target = $(e.currentTarget),
                $input = $target.is(':checkbox') && $target || $target.siblings('[type="checkbox"]'),
                id = $input.data('id'),
                room = this.rooms.get(id);

            if (!room) {
                return;
            }

            if (room.get('joined')) {
                this.client.leaveRoom(room.id);
            } else {
                this.client.joinRoom(room);
            }
        },
        turnAlert: function(e){
          var $noteIcon = $(e.currentTarget),
              id = $noteIcon.data('id');

          if (!this.rooms.get(id)){
              return;
          }

          if($noteIcon.hasClass('fa-bell-slash')){
              $noteIcon.removeClass('fa-bell-slash');
              $noteIcon.addClass('fa-bell');
          }
          else {
              $noteIcon.removeClass('fa-bell');
              $noteIcon.addClass('fa-bell-slash');
          }

          // Change the status of room's notification in db
          this.client.turnNotifications(id);
        },
        add: function(room) {
            var room = room.toJSON ? room.toJSON() : room,
                context = _.extend(room, {
                    lastActive: moment(room.lastActive).calendar()
                });
            context.activeAlert = ($.inArray(room.id, this.client.user.attributes.alertedRooms) > -1);
            if (context.isExternal) {
                this.$('.lcb-rooms-list-external').append(this.template(context));
            }
            else if(context.direct){
                //this.$('.lcb-rooms-list-direct').append(this.template(context));
                // Do nothing
            }
            else
            {
                this.$('.lcb-rooms-list-internal').append(this.template(context));
            }
        },
        remove: function(room) {
            this.$('.lcb-rooms-list-item[data-id=' + room.id + ']').remove();
        },
        update: function(room) {
            this.$('.lcb-rooms-list-item[data-id=' + room.id + '] .lcb-rooms-list-item-name').text(room.get('name'));
            this.$('.lcb-rooms-list-item[data-id=' + room.id + '] .lcb-rooms-list-item-description').text(room.get('description'));
            this.$('.lcb-rooms-list-item[data-id=' + room.id + '] .lcb-rooms-list-item-participants').text(room.get('participants'));
        },
        updateLastActive: function(room) {
            this.$('.lcb-rooms-list-item[data-id=' + room.id + '] .lcb-rooms-list-item-last-active .value').text(moment(room.get('lastActive')).calendar());
        },
        sort: function(model) {
            var that = this,
                $items = this.$('.lcb-rooms-list-item');
            // We only care about other users
            if (this.$el.hasClass('hide') && model && model.id === this.client.user.id)
                return;
            $items.sort(function(a, b){
                var ar = that.rooms.get($(a).data('id')),
                    br = that.rooms.get($(b).data('id')),
                    au = ar.users.length,
                    bu = br.users.length,
                    aj = ar.get('joined'),
                    bj = br.get('joined');
                if ((aj && bj) || (!aj && !bj)) {
                    if (au > bu) return -1;
                    if (au < bu) return 1;
                }
                if (aj) return -1;
                if (bj) return 1;
                return 0;
            });
            $items.detach();
            $items.each(function () {
                if (that.rooms.get($(this).data('id')).attributes.isExternal) {
                    that.$('.lcb-rooms-list-external').append(this);
                }
                else if(that.rooms.get($(this).data('id')).attributes.direct){
                    //that.$('lcb-rooms-list-direct').append(this);
                }
                else {
                    that.$('.lcb-rooms-list-internal').append(this);
                }
            });
        },
        filter: function(e) {
            e.preventDefault();
            var $input = $(e.currentTarget),
                needle = $input.val().toLowerCase();
            this.$('.lcb-rooms-list-item').each(function () {
                var haystack = $(this).find('.lcb-rooms-list-item-name').text().toLowerCase();
                $(this).toggle(haystack.indexOf(needle) >= 0);
            });
        },
        attachSelectize: function(textareaElement){
          var that = this;

          this.$(textareaElement).selectize({
             delimiter: ',',
             create: false,
             load: function(query, callback){
                 if(!query.length) return callback();

                 var allUsers = that.client.getUsersSync();

                 var wantedUsers = allUsers.filter(function (user) {
                    return user.attributes.username.indexOf(query) !== -1;
                 });

                 wantedUsers = _.map(wantedUsers, function(user){
                     return {
                         value: user.attributes.id,
                         text: user.attributes.username
                     };
                 });

                 callback(wantedUsers);
             }
          });
        },
        cancelRoomCreation: function(e){
          var $form = $(e.target.form);

          swal({
             title: 'Discard changes ?',
             text:'Changes won\'t be saved!',
             confirmButtonText: 'Discard',
             allowOutsideClick: false,
             type: 'warning',
             confirmButtonColor: '#F57C00',
             showCancelButton: true,
             closeOnConfirm: true
          }, function(isConfirm){
            if(isConfirm){
                $form.trigger('reset');
                $('#lcb-add-room textarea.lcb-new-room-participants').selectize()[0].selectize.clear();
                $('#lcb-add-room textarea.lcb-new-room-superusers').selectize()[0].selectize.clear();
            }
            else {
                $('#lcb-add-room').modal('show');
            }
          });
        },
        create: function(e) {
            var that = this;
            e.preventDefault();
            var $form = this.$(e.target),
                $modal = this.$('#lcb-add-room'),
                $name = this.$('.lcb-room-name'),
                $slug = this.$('.lcb-room-slug'),
                $description = this.$('.lcb-room-description'),
                $password = this.$('.lcb-room-password'),
                $confirmPassword = this.$('.lcb-room-confirm-password'),
                $participants = this.$('.lcb-new-room-participants'),
                $superusers = this.$('.lcb-new-room-superusers'),
                //$private = this.$('.lcb-room-private'), prevent public room
                data = {
                    name: $name.val().trim(),
                    // slug: $slug.val().trim(), // TODO : data.slug
                    description: $description.val(),
                    password: $password.val(),
                    private: true,// !!$private.prop('checked'), prevent public room
                    callback: function success() {
                        $modal.modal('hide');
                        $form.trigger('reset');
                        $('#lcb-add-room textarea.lcb-new-room-participants').selectize()[0].selectize.clear();
                        $('#lcb-add-room textarea.lcb-new-room-superusers').selectize()[0].selectize.clear();
                    }
                };

            // Check if the room is private
            if(data.private){

                data.participants = _.map($participants[1].getElementsByClassName("item"), function(item) {
                    return item.getAttribute("data-value");
                });

                data.superusers = _.map($superusers[1].getElementsByClassName("item"), function(item) {
                    return item.getAttribute("data-value");
                });
            }

            $name.parent().removeClass('has-error');
            $slug.parent().removeClass('has-error');
            $confirmPassword.parent().removeClass('has-error');

            // we require name is non-empty
            if (!data.name) {
                $name.parent().addClass('has-error');
                swal('Room creation', 'Room name can not be empty');
                return;
            }

            data.slug = Date.now().toString();
            // TODO : we require slug is non-empty
            if (!data.slug) {
                $slug.parent().addClass('has-error');
                return;
            }

            // remind the user, that users may share the password with others
            if (data.password) {
                if (data.password !== $confirmPassword.val()) {
                    $confirmPassword.parent().addClass('has-error');
                    return;
                }

                swal({
                    title: 'Password-protected room',
                    text: 'You\'re creating a room with a shared password.\n' +
                          'Anyone who obtains the password may enter the room.',
                    showCancelButton: true
                }, function(){
                    that.client.events.trigger('rooms:create', data);
                });
                return;
            }

            this.client.events.trigger('rooms:create', data);
        },
        addUser: function(user, room) {
            var room_users =
                this.$('.lcb-rooms-list-item[data-id="' + room.id + '"]')
                    .find('.lcb-rooms-list-users');

            // Get
            var current_users = room_users.find('#user.chip').length;
            if(current_users < 4){
                room_users.prepend(this.userTemplate(user.toJSON()));
            }
            else{
                var room_users_addition = room_users.find('#'+room.id);
                if(room_users_addition.length != 0){
                    var num = parseInt(room_users_addition.text()) || 0;
                    room_users_addition.text((num + 1) + ' more');
                }
                else{
                    room_users.append('<label id="'+room.id+'" class="hi-more-users">1 more</label>');
                }
            }
        },
        removeUser: function(user, room) {
            this.$('.lcb-rooms-list-item[data-id="' + room.id + '"]')
                .find('#user.chip[data-id="' + user.id + '"]').remove();

            var room_users =
                this.$('.lcb-rooms-list-item[data-id="'+room.id+'"]')
                    .find('.lcb-rooms-list-users');
            var current_users = room_users.find('#user.chip').length;
            var room_users_all = room_users.find('#'+room.id);

            var num = parseInt(room_users_all.text()) || 0;
            if(num -1 <= 0){
                room_users_all.text('');
                return;
            }
            room_users_all.text((num - 1) + ' more');
        }

    });

    function _split( val ) {
        return val.split( /,\s*/ );
    }
    function _extractLast( term ) {
        return _split( term ).pop();
    }


}(window, $, _);


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
            'focus .lcb-new-room-participants': 'getAutocomplete'
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

            // Get all users
            this.users = window.client.getUsersSync().map(function (user){
                return {
                    id: user.id,
                    username: user.attributes.username
                };
            })

            // Remove current user
            this.users = this.users.filter(function(user){
                if(user.id != window.client.user.id)
                    return true;
                return false;
            });

            // Map users by username
            this.usernames = this.users.map(function(user) {
                return user.username;
            });
        },

        getAutocomplete: function(){

            var that = this;
            // Apply autocomplete on the participants input
            $(".lcb-new-room-participants").autocomplete({
                source: function( request, response ) {
                    // delegate back to autocomplete, but extract the last term
                    response( $.ui.autocomplete.filter(
                        that.usernames, _extractLast( request.term ) ) );
                },
                focus: function() {
                    // prevent value inserted on focus
                    return false;
                },
                select: function( event, ui ) {
                    var terms = _split( this.value );
                    // remove the current input
                    terms.pop();
                    // add the selected item
                    terms.push( ui.item.value );
                    // add placeholder to get the comma-and-space at the end
                    terms.push( "" );
                    this.value = terms.join( ", " );
                    return false;
                }
            });
        },
        updateToggles: function(room, joined) {
            this.$('.lcb-rooms-switch[data-id=' + room.id + ']').prop('checked', joined);
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
        add: function(room) {
            var room = room.toJSON ? room.toJSON() : room,
                context = _.extend(room, {
                    lastActive: moment(room.lastActive).calendar()
                });
            if (context.isExternal == true)
            {
                this.$('.lcb-rooms-list').append(this.template(context));
            }
            else
            {
                this.$('.lcb-rooms-list-external').before(this.template(context));
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
                if (that.rooms.get($(this).data('id')).attributes.isExternal == true)
                {
                    that.$('.lcb-rooms-list').append(this);
                }
                else
                {
                    that.$('.lcb-rooms-list-external').before(this);
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
                $private = this.$('.lcb-room-private'),
                data = {
                    name: $name.val().trim(),
                    slug: $slug.val().trim(),
                    description: $description.val(),
                    password: $password.val(),
                    private: !!$private.prop('checked'),
                    callback: function success() {
                        $modal.modal('hide');
                        $form.trigger('reset');
                    }
                };

            // Check if the room is private
            if(data.private){

                // Check if participants are listed
                if($participants.val().trim()) {

                    // Temp array for splitting participants by ','
                    var temp = $participants.val().trim().split(',');
                    var participants_arr = [];

                    for(var i = 0; i < temp.length ; i++){
                        // Check if element is not empty
                        if(temp[i].trim()){
                            // Trim and push the element to participants array
                            participants_arr.push(temp[i].trim());
                        }
                    }

                    data.participants = [];

                    for(var i = 0; i < participants_arr.length; i++){
                        var user = $.grep(that.users, function(user){
                            return user.username == participants_arr[i];
                        });


                        if(user.length > 0){
                            data.participants.push(user[0].id);
                        }
                    }
                }
            }

            $name.parent().removeClass('has-error');
            $slug.parent().removeClass('has-error');
            $confirmPassword.parent().removeClass('has-error');

            // we require name is non-empty
            if (!data.name) {
                $name.parent().addClass('has-error');
                return;
            }

            // we require slug is non-empty
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
            this.$('.lcb-rooms-list-item[data-id="' + room.id + '"]')
                .find('.lcb-rooms-list-users').prepend(this.userTemplate(user.toJSON()));
        },
        removeUser: function(user, room) {
            this.$('.lcb-rooms-list-item[data-id="' + room.id + '"]')
                .find('.lcb-rooms-list-user[data-id="' + user.id + '"]').remove();
        }

    });

    function _split( val ) {
        return val.split( /,\s*/ );
    }
    function _extractLast( term ) {
        return _split( term ).pop();
    }


}(window, $, _);


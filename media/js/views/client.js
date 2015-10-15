/*
 * CLIENT VIEW
 * The king of all views.
 */

'use strict';

+function(window, $, _) {

    window.LCB = window.LCB || {};

    window.LCB.ClientView = Backbone.View.extend({
        el: '#lcb-client',
        events: {
            'click .lcb-tab': 'toggleSideBar',
            'click #nav-button': 'toggleNavbar',
            'click .hi-create-direct-message': 'newDirectMessage',
            'click .lcb-header-toggle': 'toggleSideBar'
        },
        initialize: function(options) {
            this.client = options.client;
            //
            // Subviews
            //
            this.browser = new window.LCB.BrowserView({
                el: this.$el.find('.lcb-rooms-browser'),
                rooms: this.client.rooms,
                client: this.client
            });
            this.tabs = new window.LCB.TabsView({
                el: this.$el.find('.lcb-tabs'),
                rooms: this.client.rooms,
                client: this.client
            });
            this.panes = new window.LCB.PanesView({
                el: this.$el.find('.lcb-panes'),
                rooms: this.client.rooms,
                client: this.client
            });
            this.window = new window.LCB.WindowView({
                rooms: this.client.rooms,
                client: this.client
            });
            this.hotKeys = new window.LCB.HotKeysView({
                rooms: this.client.rooms,
                client: this.client
            });
            this.status = new window.LCB.StatusView({
                el: this.$el.find('.lcb-status-indicators'),
                client: this.client
            });
            this.accountButton = new window.LCB.AccountButtonView({
                el: this.$el.find('.lcb-account-button'),
                model: this.client.user
            });
            this.desktopNotifications = new window.LCB.DesktopNotificationsView({
                rooms: this.client.rooms,
                client: this.client
            });
            if (this.client.options.filesEnabled) {
                this.upload = new window.LCB.UploadView({
                    el: this.$el.find('#lcb-upload'),
                    rooms: this.client.rooms
                });
            }

            //
            // Modals
            //
            this.profileModal = new window.LCB.ProfileModalView({
                el: this.$el.find('#lcb-profile'),
                model: this.client.user
            });
            this.accountModal = new window.LCB.AccountModalView({
                el: this.$el.find('#lcb-account'),
                model: this.client.user
            });
            this.tokenModal = new window.LCB.AuthTokensModalView({
                el: this.$el.find('#lcb-tokens')
            });
            this.notificationsModal = new window.LCB.NotificationsModalView({
                el: this.$el.find('#lcb-notifications')
            });
            //
            // Misc
            //
            this.client.status.once('change:connected', _.bind(function(status, connected) {
                this.$el.find('.lcb-client-loading').hide(connected);
            }, this));

            //
            // Selectize
            //
            this.attachSelectize('.lcb-direct-user-name');

            this.client.createDirectMessage = this.createDirectMessage;

            return this;
        },
        createDirectMessage: function(user){
            var current_user = window.client.user;

            // Don't let user send a direct message to himself;
            if(current_user.id == user.id){
                return;
            }

            // To check if I already created this room
            var slug = user.id + current_user.id;
            var opposite_slug = current_user.id + user.id;

            var room = window.client.rooms.findWhere({
                slug: slug
            });

            room = room || window.client.rooms.findWhere({
                slug: opposite_slug
            });

            // Room not created
            if(!room){
                var data = {
                    name: window.client.user.get('displayName'),
                    participants: [user.id, current_user.id],
                    private: true,
                    slug: slug,
                    direct: true,
                    directName: user.get('displayName')
                };

                window.client.events.trigger('rooms:create', data);
            }
            else{
                window.client.rooms.last.set('id',window.client.rooms.current.get('id'));
                window.client.rooms.current.set('id',room.id);
                window.client.router.navigate('!/room/'+room.id,{
                    replace: true
                });
            }
        },
        toggleNavbar: function(e){

        },
        toggleSideBar: function(e) {
            this.$el.toggleClass('lcb-sidebar-opened');
        },
        newDirectMessage: function(e){
            $('.lcb-new-direct-message').addClass('hide');
            $('.lcb-direct-user-name').removeClass('hide');
            $('.lcb-direct-user-name input').focus();
        },
        clearDirectMessage: function(e){
            $('.lcb-direct-user-name')[0].selectize.clear();
        },
        attachSelectize: function(textareaElement){
            var that = this;
            var all_users = that.client.getUsersSync();

            this.$(textareaElement).selectize({
               delimiter: ',',
               create: false,
               render:{
                   option: function(item, escape){
                       return '<div class="user-item">'+
                            '<img class="lcb-avatar user-icon" width="30" height="30" src="'+item.icon+'"></img>'+
                            '<span class="lcb-room-sidebar-user-name">'+item.displayName+'</span>'+
                            '<span class="lcb-room-sidebar-user-username">'+item.text+'</span>'+
                            '</div>';
                   }
               },
               onChange: function(val){
                   if(val){
                       var user = all_users.findWhere({username: val});
                       if(!user || user.id == window.client.user.id){
                           that.clearDirectMessage();
                           return;
                       }

                       that.clearDirectMessage();
                       $('#directMessageModal').closeModal();
                       that.createDirectMessage(user);
                   }
               },
               load: function(query, callback){
                   if(!query.length) return callback();

                   var users = _.filter(all_users.models, function(user){
                      return user.get('username').indexOf(query) !== -1;
                   });

                   users = _.map(users, function(user){
                       return{
                           value: user.get('username'),
                           text: user.get('username'),
                           icon: '/users/'+user.id+'/avatar',
                           displayName: user.get('displayName')
                       };
                   });

                   callback(users);
               }
            });
        }
    });

    window.LCB.AccountButtonView = Backbone.View.extend({
        initialize: function() {
            this.model.on('change', this.update, this);
        },
        update: function(user){
            this.$('.lcb-account-button-username').text('@' + user.get('username'));
            this.$('.lcb-account-button-name').text(user.get('displayName'));
        }
    });


}(window, $, _);

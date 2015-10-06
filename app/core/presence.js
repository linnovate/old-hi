'use strict';

var Connection = require('./presence/connection'),
    Room = require('./presence/room'),
    ConnectionCollection = require('./presence/connection-collection'),
    RoomCollection = require('./presence/room-collection'),
    UserCollection = require('./presence/user-collection'),
    mongoose = require('mongoose');

function PresenceManager(options) {
    this.core = options.core;
    this.system = new Room({ system: true });
    this.connections = new ConnectionCollection();
    this.rooms = new RoomCollection();
    this.users = new UserCollection({ core: this.core });
    this.rooms.on('user_join', this.onJoin.bind(this));
    this.rooms.on('user_leave', this.onLeave.bind(this));
    this.rooms.on('user_disconnected', this.onDisconnected.bind(this));

    this.connect = this.connect.bind(this);
    this.getUserCountForRoom = this.getUserCountForRoom.bind(this);
    this.getUsersForRoom = this.getUsersForRoom.bind(this);
}

PresenceManager.prototype.getUserCountForRoom = function(roomId) {
    var room = this.rooms.get(roomId);
    return room ? room.userCount : 0;
};

PresenceManager.prototype.getUsersForRoom = function(roomId) {
    var room = this.rooms.get(roomId);
    return room ? room.getUsers() : [];
};

PresenceManager.prototype.connect = function(connection) {
    this.system.addConnection(connection);
    this.core.emit('connect', connection);

    connection.user = this.users.getOrAdd(connection.user);

    connection.on('disconnect', function() {
        this.disconnect(connection);
    }.bind(this));
};

PresenceManager.prototype.disconnect = function(connection) {
    this.system.removeConnection(connection);
    this.core.emit('disconnect', connection);
    this.rooms.removeConnection(connection);
    
    // ADDED: By Avi I hope this is the right place
    
    (function(user_id){
        var User = mongoose.model('User');
        User.findById(user_id, function(err, user){
            if(err){
                //Oh noes, a bad thing happend!
                console.log(err);
                return;
            }
            
            user.lastLogOut = Date.now();
            user.save();
        });
    })(connection.user.id);
};

PresenceManager.prototype.join = function(connection, room,dontEmit) {
    var pRoom = this.rooms.getOrAdd(room);
    pRoom.addConnection(connection,dontEmit);
};

PresenceManager.prototype.leave = function(connection, roomId,dontEmit) {
    var room = this.rooms.get(roomId);
    if (room) {
        room.removeConnection(connection,dontEmit);
    }
};

PresenceManager.prototype.onJoin = function(data) {
    this.core.emit('presence:user_join', data);
};

PresenceManager.prototype.onLeave = function(data) {
    this.core.emit('presence:user_leave', data);
};

PresenceManager.prototype.onDisconnected = function(data) {
    this.core.emit('presence:user_disconnected', data);
};

PresenceManager.Connection = Connection;
module.exports = PresenceManager;

'use strict';

var mongoose = require('mongoose'),
    _ = require('lodash'),
    helpers = require('./helpers');

// Select users details from db by them ids
var getUsersModel = function(room, userIds, cb) {
    if (!room.private || !userIds) {
        return cb(null, []);
    }

    userIds = _.chain(userIds)
        .filter(function(user) { return !!user; })
        .uniq()
        .value();

    var User = mongoose.model('User');
    User.find({_id: { $in: userIds } }, cb);
};

// Check if authorized superusers has been changed by comparing between
// previous permissions (previous) to new permissions (update) changed by jo
var isSuperusersHasChanged = function(previous, update){
    if (previous.length !== update.length){
        return true;
    }

    for (var i = 0; i < previous.length; i++){
        if (previous[i].toString() !== update[i]._id.toString()){
            return true;
        }
    }

    return false;
};

// Superusers and owner shouldn't be participants changed by jo
var cleanParticipants = function(participants, superusers, owner){
    var justParticipants =[];

    for (var i = 0; i < participants.length; i++){
        if (!(owner.toString() == participants[i]._id.toString())){

            var isSuperuser = false;
            for (var j = 0; j < superusers.length && !isSuperuser; j++){
                if(participants[i]._id.toString() == superusers[j]._id.toString()){
                    isSuperuser = true;
                }
            }

            if (!isSuperuser){
                justParticipants.push(participants[i]);
            }
        }
    }

    return justParticipants;
};

// Owner shouldn't be Superuser changed by jo
var cleanSuperusers = function(superusers, owner){
    var justSuperusers =[];

    for (var i = 0; i < superusers.length; i++){
        if (!(owner.toString() == superusers[i]._id.toString())){
            justSuperusers.push(superusers[i]);
        }
    }

    return justSuperusers;
};

// Get the unauthorized users by comparing between previous permissions (previous)
// to new permissions (update) changed by jo
var getUnauthorizedUsers = function(previous,update){
    var isAuthorized = false;
    var unauthorizedUsers = [];

    for (var i = 0; i < previous.length; i++){
        for (var j = 0; j < update.length && !isAuthorized; j++){
            if(update[j]._id.toString() == previous[i].toString()){
                isAuthorized = true;
            }
        }

        if (!isAuthorized){
            unauthorizedUsers.push(previous[i]);
        }

        isAuthorized = false;
    }

    return unauthorizedUsers;
};

// Get the new authorized users by comparing between previous permissions (previous)
// to new permissions (update) changed by jo
var getNewAuthorizedUsers = function(previous,update){
    var isNew = true;
    var newAuthorizedUsers = [];

    for (var i = 0; i < update.length; i++){
        for (var j = 0; j < previous.length && isNew; j++){
            if(update[i]._id.toString() == previous[j].toString()){
                isNew = false;
            }
        }

        if (isNew){
            newAuthorizedUsers.push(update[i]);
        }

        isNew = true;
    }

    return newAuthorizedUsers;
};

// Remove unauthorized users from room's enabled members and append the new authorized
// changed by jo
var updateEnabledMembers = function(enabledMembers, unauthorized, newAuthorized){
    var isExist = false;

    // Remove unauthorized users
    for (var i = 0; i < unauthorized.length; i++){
        enabledMembers.pull(unauthorized[i].toString());
    }

    // Insert new authorized users, make sure that he is not exist before
    for (var x = 0; x < newAuthorized.length; x++){
        for (var y = 0; y < enabledMembers.length && !isExist; y++){
            if(newAuthorized[x]._id.toString() == enabledMembers[y].toString()){
                isExist = true;
            }
        }

        if (!isExist){
            enabledMembers.push(newAuthorized[x]._id.toString());
        }
        isExist = false;
    }

    return enabledMembers;
};

function RoomManager(options) {
    this.core = options.core;
}

RoomManager.prototype.canJoin = function(options, cb) {
    var method = options.id ? 'get' : 'slug',
        roomId = options.id ? options.id : options.slug;

    this[method](roomId, function(err, room) {
        if (err) {
            return cb(err);
        }

        if (!room) {
            return cb();
        }

        room.canJoin(options, function(err, canJoin) {
            cb(err, room, canJoin);
        });
    });
};

RoomManager.prototype.create = function(options, cb) {
    var Room = mongoose.model('Room');
    var core = this.core;

    // Translate from string of authorized user names to ids array
    getUsersModel({private: options.private}, options.participants, function(err, participants){
        if(err){
            // Oh noes, a bad thing happend!
             console.error(err);
             return cb(err);
        }

        // Chnaged by jo
        getUsersModel({private:options.private}, options.superusers, function(err, superusers){
            if(err){
                // Oh noes, a bad thing happend!
                console.error(err);
                return cb(err);
            }

            if (options.private){

                // Prevent duplicate of roles to the same user changed by jo
                superusers = cleanSuperusers(superusers, options.owner);
                participants = cleanParticipants(participants, superusers, options.owner);

                // Get changed permission data in order to update room's enabled members
                // and room's connected users changed by jo
                var newAuthorizedUsers = getNewAuthorizedUsers([],superusers.concat(participants));
                options.enabledMembers = updateEnabledMembers([],[],newAuthorizedUsers);
                options.participants = participants;
                options.superusers = superusers;
            }

            Room.create(options, function(err, room) {
                if (err) {
                    console.error(err);
                    return cb(err);
                }

                room = room;// why we need that? jo

                if(room.private){
                    // Update room's online users
                    Room.populate(room, {path:'enabledMembers participants superusers'}, function(err, room){
                        if(err){
                            console.error(err);
                            return cb(err);
                        }
                        // Remove unauthorized connections from room and append the new authorized
                        // connections. changed by jo
                        core.emit('rooms:update',room,[],newAuthorizedUsers);
                    });
                }
                else{
                    core.emit('rooms:new', room);
                }
                cb(null,room);
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

RoomManager.prototype.update = function(roomId, options, cb) {
    var Room = mongoose.model('Room');
    var that = this;

    Room.findById(roomId, function(err, room) {
        if (err) {
            // Oh noes, a bad thing happened!
            console.error(err);
            return cb(err);
        }

        if (!room) {
            return cb('Room does not exist.');
        }

        if(!room.owner.equals(options.user)) {
            var isSuperuser = false;
            for (var i = 0; i < room.superusers.length && !isSuperuser; i++)
            {
                if (room.superusers[i].equals(options.user)) {
                    isSuperuser = true;
                }
            }

            if (!isSuperuser) {
                return cb('Only owner can change private room.');
            }
        }

        // Translate from string of authorized user names to ids array
        getUsersModel(room, options.participants, function(err, participants) {
            if (err) {
                // Oh noes, a bad thing happened!
                console.error(err);
                return cb(err);
            }
            // changed by jo
            getUsersModel(room, options.superusers, function(err, superusers) {
                if (err) {
                    // Oh noes, a bad thing happened!
                    console.error(err);
                    return cb(err);
                }

                // When superusers has changed owner permission required changed by jo
                if (isSuperusersHasChanged(room.superusers, superusers)
                    && !room.owner.equals(options.user)){
                    return cb('Only owner can edit superusers.');
                }

                room.name = options.name;
                // DO NOT UPDATE SLUG
                // room.slug = options.slug;
                room.description = options.description;

                if (room.private) {
                    // Prevent duplicate of roles to the same user changed by jo
                    superusers = cleanSuperusers(superusers,room.owner);
                    participants = cleanParticipants(participants,superusers,room.owner);

                    // Get changed permission data in order to update room's enabled members
                    // and room's connected users changed by jo
                    var unauthorizedUsers = getUnauthorizedUsers(room.superusers.concat(room.participants),
                        superusers.concat(participants));
                    var newAuthorizedUsers = getNewAuthorizedUsers(room.superusers.concat(room.participants),
                        superusers.concat(participants));
                    room.enabledMembers = updateEnabledMembers(room.enabledMembers,
                                                               unauthorizedUsers,
                                                               newAuthorizedUsers);
                    room.password = options.password;
                    room.participants = participants;
                    room.superusers = superusers;
                }

                room.save(function (err, room) {
                    if (err) {
                        console.error(err);
                        return cb(err);
                    }
                    room = room;// why we need that? jo

                    if (room.private){
                        // Update room's online users
                        Room.populate(room,{path:'enabledMembers participants superusers'},function(err,room){
                            // Remove unauthorized connections from room and append the new authorized
                            // connections. changed by jo
                            that.core.emit('rooms:update', room, unauthorizedUsers, newAuthorizedUsers);
                        });
                    }
                    else {
                        this.core.emit('rooms:update', room);
                    }
                    cb(null, room);
                }.bind(this));
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

RoomManager.prototype.archive = function(roomId, userId, cb) {
    var Room = mongoose.model('Room');

    Room.findById(roomId, function(err, room) {
        if (err) {
            // Oh noes, a bad thing happened!
            console.error(err);
            return cb(err);
        }

        if (!room) {
            return cb('Room does not exist.');
        }

        if(room.owner.toString() !== userId){
            return cb('Only owner can archive room');
        }

        room.archived = true;
        room.save(function(err, room) {
            if (err) {
                console.error(err);
                return cb(err);
            }
            cb(null, room);
            this.core.emit('rooms:archive', room);

        }.bind(this));
    }.bind(this));
};

RoomManager.prototype.list = function(options, cb) {
    options = options || {};

    options = helpers.sanitizeQuery(options, {
        defaults: {
            take: 500
        },
        maxTake: 5000
    });

    var Room = mongoose.model('Room');

    var find = Room.find({
        archived: { $ne: true },
        $or: [
            {private: {$exists: false}},
            {private: false},

            {owner: options.userId},

            {participants: options.userId},

            // changed by jo
            {superusers: options.userId},

            {password: {$exists: true, $ne: ''}}
        ]
    });

    if (options.skip) {
        find.skip(options.skip);
    }

    if (options.take) {
        find.limit(options.take);
    }

    if (options.sort) {
        var sort = options.sort.replace(',', ' ');
        find.sort(sort);
    } else {
        find.sort('-lastActive');
    }

    // changed by jo
    find.populate('participants superusers enabledMembers');

    find.exec(function(err, rooms) {
        if (err) {
            return cb(err);
        }

        _.each(rooms, function(room) {
            this.sanitizeRoom(options, room);
        }, this);

        if (options.users && !options.sort) {
            rooms = _.sortByAll(rooms, ['userCount', 'lastActive'])
                     .reverse();
        }

        cb(null, rooms);

    }.bind(this));
};

RoomManager.prototype.sanitizeRoom = function(options, room) {
    var authorized = options.userId && room.isAuthorized(options.userId);

    if (options.users) {
        if (authorized) {
            room.users = this.core.presence
                        .getUsersForRoom(room.id.toString());
        } else {
            room.users = [];
        }
    }
};

RoomManager.prototype.findOne = function(options, cb) {
    var Room = mongoose.model('Room');
    Room.findOne(options.criteria)
        // changed by jo
        .populate('participants').populate('superusers').exec(function(err, room) {

        if (err) {
            return cb(err);
        }

        this.sanitizeRoom(options, room);
        cb(err, room);

    }.bind(this));
};

RoomManager.prototype.get = function(options, cb) {
    var identifier;

    if (typeof options === 'string') {
        identifier = options;
        options = {};
        options.identifier = identifier;
    } else {
        identifier = options.identifier;
    }

    options.criteria = {
        _id: identifier,
        archived: { $ne: true }
    };

    this.findOne(options, cb);
};

RoomManager.prototype.slug = function(options, cb) {
    var identifier;

    if (typeof options === 'string') {
        identifier = options;
        options = {};
        options.identifier = identifier;
    } else {
        identifier = options.identifier;
    }

    options.criteria = {
        slug: identifier,
        archived: { $ne: true }
    };

    this.findOne(options, cb);
};

// Append user to room enabled members - changed by jo
RoomManager.prototype.pushUser = function(userId, roomId, cb){
    var Room = mongoose.model('Room');

    Room.findById(roomId, function(err, room) {
        if (err) {
            console.error(err);
            return cb(err);
        }

        var isExist = false;
        for (var i = 0; i < room.enabledMembers.length && !isExist; i++)
        {
            if (room.enabledMembers[i].toString() == userId)
            {
                isExist = true;
            }
        }

        if (!isExist) {
            room.enabledMembers.push(userId);
            room.save(function (err, room) {
                if (err) {
                    console.error(err);
                    return cb(err);
                }
                room = room;// why we need that? jo
            })
        }
    })
};

// Remove user from room enabled members - changed by jo
RoomManager.prototype.pullUser = function(userId, roomId, cb) {
    var Room = mongoose.model('Room');

    Room.findById(roomId, function(err, room) {
        if (err) {
            console.error(err);
            return cb(err);
        }

        var isExist = false;
        for (var i = 0; i < room.enabledMembers.length && !isExist; i++)
        {
            if (room.enabledMembers[i].toString() == userId)
            {
                isExist = true;
            }
        }

        if (isExist) {
            room.enabledMembers.pull(userId);
            room.save(function (err, room) {
                if (err) {
                    console.error(err);
                    return cb(err);
                }
                room = room;// why we need that? jo
            })
        }
    })
};

// Get all user enabled rooms changed by jo
RoomManager.prototype.getUserRooms = function(userId, cb){
    var Room = mongoose.model('Room');

    Room.find({enabledMembers:userId}, function(err, rooms){
        if(err)
        {
            console.log(err);
            return cb(err);
        }

        cb(null, rooms);
    });
};

module.exports = RoomManager;

'use strict';

var mongoose = require('mongoose'),
    _ = require('lodash'),
    helpers = require('./helpers');

var getParticipants = function(room, options, cb) {
    if (!room.private || !options.participants) {
        return cb(null, []);
    }

    var participants = [];

    if (Array.isArray(options.participants)) {
        participants = options.participants;
    }

    if (typeof options.participants === 'string') {
        participants = options.participants.replace(/@/g, '')
            .split(',').map(function(username) {
                return username.trim();
            });
    }

    participants = _.chain(participants)
        .map(function(username) {
            return username && username.replace(/@,\s/g, '').trim();
        })
        .filter(function(username) { return !!username; })
        .uniq()
        .value();

    var User = mongoose.model('User');
    User.find({username: { $in: participants } }, cb);
};
// Translate superusers from long string of names to ids array changed by jo
var getSuperusers = function(room, options, cb) {
    if (!room.private || !options.superusers) {
        return cb(null, []);
    }

    var superusers = [];

    if (Array.isArray(options.superusers)) {
        superusers = options.superusers;
    }

    if (typeof options.superusers === 'string') {
        superusers = options.superusers.replace(/@/g, '')
            .split(',').map(function(username) {
                return username.trim();
            });
    }

    superusers = _.chain(superusers)
        .map(function(username) {
            return username && username.replace(/@,\s/g, '').trim();
        })
        .filter(function(username) { return !!username; })
        .uniq()
        .value();

    var User = mongoose.model('User');
    User.find({username: { $in: superusers } }, cb);
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
        if (!owner.equals(participants[i]._id)){

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
        if (!owner.equals(superusers[i]._id)){
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
    Room.create(options, function(err, room) {
        if (err) {
            return cb(err);
        }

        if (cb) {
            room = room;// why we need that? jo
            cb(null, room);
            this.core.emit('rooms:new', room);
        }
    }.bind(this));
};

RoomManager.prototype.update = function(roomId, options, cb) {
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

        if(room.private && !room.owner.equals(options.user.id)) {
            var isSuperuser = false;
            for (var i = 0; i < room.superusers.length && !isSuperuser; i++)
            {
                if (room.superusers[i].equals(options.user.id)) {
                    isSuperuser = true;
                }
            }

            if (!isSuperuser) {
                return cb('Only owner can change private room.');
            }
        }

        // Translate from string of authorized user names to ids array
        getParticipants(room, options, function(err, participants) {
            if (err) {
                // Oh noes, a bad thing happened!
                console.error(err);
                return cb(err);
            }
            // changed by jo
            getSuperusers(room, options, function(err, superusers) {
                if (err) {
                    // Oh noes, a bad thing happened!
                    console.error(err);
                    return cb(err);
                }

                // When superusers has changed owner permission required changed by jo
                if (isSuperusersHasChanged(room.superusers, superusers)
                    && !room.owner.equals(options.user.id)){
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
                        // Remove unauthorized connections from room and append the new authorized
                        // connections. changed by jo
                        this.core.emit('rooms:remove_connections', unauthorizedUsers, room);
                        this.core.emit('rooms:append_connections', newAuthorizedUsers, room);
                    }
                    cb(null, room);
                    this.core.emit('rooms:update', room);
                }.bind(this));
            }.bind(this));
        }.bind(this));
    }.bind(this));
};

RoomManager.prototype.archive = function(roomId, cb) {
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

    find.populate('participants');
    // changed by jo
    find.populate('superusers');

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

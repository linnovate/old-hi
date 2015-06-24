//
// Room
//

'use strict';

var mongoose = require('mongoose'),
    uniqueValidator = require('mongoose-unique-validator'),
    bcrypt = require('bcryptjs');

var ObjectId = mongoose.Schema.Types.ObjectId;

var RoomSchema = new mongoose.Schema({
    slug: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true,
        match: /^[a-z0-9_]+$/i
    },
    archived: {
        type: Boolean,
        default: false
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    owner: {
		type: ObjectId,
		ref: 'User',
        required: true
    },
    superusers: [{
        type: ObjectId,
        ref: 'User'
    }],
    participants: [{ // We can have an array per role
		type: ObjectId,
		ref: 'User'
	}],
    enabledMembers:[{
        type: ObjectId,
        ref: 'User'
    }],
	messages: [{
		type: ObjectId,
		ref: 'Message'
	}],
    created: {
        type: Date,
        default: Date.now
    },
    lastActive: {
        type: Date,
        default: Date.now
    },
    private: {
        type: Boolean,
        default: false
    },
    password: {
        type: String,
        required: false//only for password-protected room
    }
});

RoomSchema.virtual('handle').get(function() {
    return this.slug || this.name.replace(/\W/i, '');
});

RoomSchema.virtual('hasPassword').get(function() {
    return !!this.password;
});

RoomSchema.pre('save', function(next) {
    var room = this;
    if (!room.password || !room.isModified('password')) {
        return next();
    }

    bcrypt.hash(room.password, 10, function(err, hash) {
        if (err) {
            return next(err);
        }
        room.password = hash;
        next();
    });
});

RoomSchema.plugin(uniqueValidator, {
    message: 'Expected {PATH} to be unique'
});

RoomSchema.method('isAuthorized', function(userId) {
    if (!userId) {
        return false;
    }

    userId = userId.toString();

    // Check if userId doesn't match MongoID format
    if (!/^[a-f\d]{24}$/i.test(userId)) {
        return false;
    }

    if (!this.password && !this.private) {
        return true;
    }

    if (this.owner.equals(userId)) {
        return true;
    }

    // Check also if user have authorization for superusers changed by jo
    var AuthorizedUsers = [];
    AuthorizedUsers = this.participants.concat(this.superusers);

    return AuthorizedUsers.some(function(AuthorizedUser) {
        if (AuthorizedUser._id) {
            return AuthorizedUser._id.equals(userId);
        }

        if (AuthorizedUser.equals) {
            return AuthorizedUser.equals(userId);
        }

        if (AuthorizedUser.id) {
            return AuthorizedUser.id === userId;
        }

        return AuthorizedUser === userId;
    });
});

RoomSchema.method('canJoin', function(options, cb) {
    var userId = options.userId,
        password = options.password,
        saveMembership = options.saveMembership;

    if (this.isAuthorized(userId)) {
        return cb(null, true);
    }

    if (!this.password) {
        return cb(null, false);
    }

    bcrypt.compare(password || '', this.password, function(err, isMatch) {
        if(err) {
            return cb(err);
        }

        if (!isMatch) {
            return cb(null, false);
        }

        if (!saveMembership) {
            return cb(null, true);
        }

        this.participants.push(userId);

        this.save(function(err) {
            if(err) {
                return cb(err);
            }

            cb(null, true);
        });

    }.bind(this));
});

RoomSchema.method('toJSON', function(user) {
    var userId = user ? (user._id || user.id || user) : null;
    var authorized = false;

    if (userId) {
        authorized = this.isAuthorized(userId);
    }

    var room = this.toObject();

    var data = {
        id: room._id,
        slug: room.slug,
        name: room.name,
        description: room.description,
        lastActive: room.lastActive,
        created: room.created,
        owner: room.owner,
        private: room.private,
        hasPassword: this.hasPassword,
        participants: [],
        superusers: []
    };

    if (room.private && authorized) {
        var participants = this.participants || [];
        var superusers = this.superusers || [];
        data.participants = participants.map(function(user) {
            return user.username ? user.username : user;
        });
        // changed by jo
        data.superusers = superusers.map(function(user) {
            return user.username ? user.username : user;
        });
    }

    if (this.users) {
        data.users = this.users;
        data.userCount = this.users.length;
    }

    return data;
 });

RoomSchema.statics.findByIdOrSlug = function(identifier, cb) {
    var opts = {
        archived: { $ne: true }
    };

    if (identifier.match(/^[0-9a-fA-F]{24}$/)) {
        opts.$or = [{_id: identifier}, {slug: identifier}];
    } else {
        opts.slug = identifier;
    }

    this.findOne(opts, cb);
};

module.exports = mongoose.model('Room', RoomSchema);

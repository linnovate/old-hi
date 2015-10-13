//
// Rooms Controller
//

'use strict';

var settings = require('./../config');

module.exports = function() {
    var app = this.app,
        core = this.core,
        middlewares = this.middlewares,
        models = this.models,
        User = models.user;

    core.on('presence:user_join', function(data) {
        User.findById(data.userId, function (err, user) {
            if (!err && user) {
                user = user.toJSON();
                // changed by jo in order to present user like logged-in in room's users list
                user.isConnected = true;
                user.room = data.roomId;
                if (data.roomHasPassword) {
                    app.io.to(data.roomId).emit('users:join', user);
                } else {
                    app.io.emit('users:join', user);
                }
            }
        });
    });

    core.on('presence:user_leave', function(data) {
        User.findById(data.userId, function (err, user) {
            if (!err && user) {
                user = user.toJSON();
                user.room = data.roomId;
                if (data.roomHasPassword) {
                    app.io.to(data.roomId).emit('users:leave', user);
                } else {
                    app.io.emit('users:leave', user);
                }
            }
        });
    });

    core.on('presence:user_disconnected', function(data) {
        User.findById(data.userId, function (err, user) {
            if (!err && user) {
                user = user.toJSON();
                user.isConnected = false;
                user.room = data.roomId;
                if (data.roomHasPassword) {
                    app.io.to(data.roomId).emit('users:disconnected', user);
                } else {
                    app.io.emit('users:disconnected', user);
                }
            }
        });
    });

    var getEmitters = function(room) {
        if (room.private && !room.hasPassword) {
            var connections = core.presence.system.connections.query({
                type: 'socket.io'
            }).filter(function(connection) {
                return room.isAuthorized(connection.user.id);
            });

            return connections.map(function(connection) {
                return {
                    emitter: connection.socket,
                    user: connection.user
                };
            });
        }

        return [{
            emitter: app.io
        }];
    };

    core.on('rooms:new', function(room) {
        var emitters = getEmitters(room);
        emitters.forEach(function(e) {
            e.emitter.emit('rooms:new', room.toJSON(e.user));
        });
    });

    core.on('rooms:update', function(room,unauthorizedUsers, newAuthorizedUsers) {
        var users = [];
        var onLineUsers;

        if(unauthorizedUsers) {
            var connections = core.presence.system.connections.query({
                type: 'socket.io'
            }).filter(function(connection){
                return room.isAuthorized(connection.user.id);
            });

            onLineUsers = connections.map(function(connection){
                return {
                  emitter: connection.socket,
                  user: connection.user
                };
            });

            var dontEmit = true;

            users = room.enabledMembers.map(function (member) {
                var user = {
                    id: member.id,
                    displayName: member.displayName,
                    username: member.username,
                    firstName: member.firstName,
                    lastName: member.lastName,
                    avatar: member.avatar
                };

                for (var i = 0; i < onLineUsers.length; i++) {
                    if (onLineUsers[i].user.id == user.id)
                        user.isConnected = true;
                }

                return user;
            });

            for (var i = 0; i < unauthorizedUsers.length; i++) {
                var userConnections = core.presence.system.connections.query({
                    type: 'socket.io',
                    userId: unauthorizedUsers[i].toString()
                });

                for (var j = 0; j < userConnections.length; j++) {
                    core.presence.leave(userConnections[j], room.id, dontEmit);
                    userConnections[j].socket.leave(room.id);
                    userConnections[j].socket.emit('rooms:fire', room.id);
                }
            }

            for (i = 0; i < newAuthorizedUsers.length; i++) {
                userConnections = core.presence.system.connections.query({
                    type: 'socket.io',
                    userId: newAuthorizedUsers[i]._id
                });

                for (j = 0; j < userConnections.length; j++) {
                    core.presence.join(userConnections[j], room, dontEmit); // update already connected users
                    userConnections[j].socket.join(room.id); // connect user in order to receive and send messages, without taking room meta data
                    userConnections[j].socket.emit('rooms:append', room.toJSON(newAuthorizedUsers[i].id), users);
                }
            }
        }

        onLineUsers = getEmitters(room);
        onLineUsers.forEach(function(e) {
            e.emitter.emit('rooms:update', room.toJSON(e.user),users);
        });
    });

    core.on('rooms:archive', function(room) {
        var emitters = getEmitters(room);
        emitters.forEach(function(e) {
            e.emitter.emit('rooms:archive', room.toJSON(e.user));
        });
    });

    //
    // Routes
    //
    app.route('/rooms')
        .all(middlewares.requireLogin)
        .get(function(req) {
            req.io.route('rooms:list');
        })
        .post(function(req) {
            req.io.route('rooms:create');
        });

    app.route('/rooms/:room')
        .all(middlewares.requireLogin, middlewares.roomRoute)
        .get(function(req) {
            req.io.route('rooms:get');
        })
        .put(function(req) {
            req.io.route('rooms:update');
        })
        .delete(function(req) {
            req.io.route('rooms:archive');
        });

    app.route('/rooms/:room/users')
        .all(middlewares.requireLogin, middlewares.roomRoute)
        .get(function(req) {
            req.io.route('rooms:users');
        });


    //
    // Sockets
    //
    app.io.route('rooms', {
        list: function(req, res) {
            var options = {
                    userId: req.user._id,
                    users: req.param('users'),

                    skip: req.param('skip'),
                    take: req.param('take')
                };

            core.rooms.list(options, function(err, rooms) {
                if (err) {
                    console.error(err);
                    return res.status(400).json(err);
                }

                var results = rooms.map(function(room) {
                    return room.toJSON(req.user);
                });

                res.json(results);
            });
        },
        get: function(req, res) {
            var options = {
                userId: req.user._id.toString(),
                identifier: req.param('room') || req.param('id')
            };

            if (options.userId == settings.auth.icapi.id){
                options.userId = req.param('userId');
            }

            core.rooms.get(options, function(err, room) {
                if (err) {
                    console.error(err);
                    return res.status(400).json(err);
                }

                if (!room) {
                    return res.sendStatus(404);
                }

                res.json(room.toJSON(options.userId));
            });
        },
        create: function(req, res) {

            var options = {
                owner: req.user._id.toString(),
                name: req.param('name'),
                slug: Date.now().toString(),
                description: req.param('description'),
                private: true, //req.param('private'),
                password: req.param('password'),
                participants: req.param('participants'),
                superusers: req.param('superusers'),
                direct: req.param('direct'),
                directName: req.param('directName')
            };

            if(options.owner == settings.auth.icapi.id){
                options.owner = req.param('owner');
                options.isExternal = true;
            }

            if (!settings.rooms.private) {
                options.private = false;
                delete options.password;
                delete options.participants;
                delete options.superusers;
            }

            core.rooms.create(options, function(err, room) {
                if (err) {
                    console.error(err);
                    return res.status(400).json(err);
                }

                res.status(201).json(room.toJSON(options.owner));
            });
        },
        update: function(req, res) {
            var roomId = req.param('room') || req.param('id');

            var options = {
                    name: req.param('name'),
                    slug: req.param('slug'),
                    description: req.param('description'),
                    password: req.param('password'),
                    participants: req.param('participants'),
                    superusers: req.param('superusers'),
                    user: req.user._id.toString()
                };

            if (!settings.rooms.private) {
                delete options.password;
                delete options.participants;
                delete options.superusers;
            }

            if(options.user == settings.auth.icapi.id){
                options.user = req.param('owner');
            }

            core.rooms.update(roomId, options, function(err, room) {
                if (err) {
                    console.error(err);
                    return res.status(400).json(err);
                }

                if (!room) {
                    return res.sendStatus(404);
                }

                res.json(room.toJSON(options.user));
            });
        },
        archive: function(req, res) {
            var roomId = req.param('room') || req.param('id');
            var userId = req.user._id.toString();

            if (userId == settings.auth.icapi.id){
                userId = req.param('owner');
            }

            core.rooms.archive(roomId, userId, function(err, room) {
                if (err) {
                    console.log(err);
                    return res.sendStatus(400);
                }

                if (!room) {
                    return res.sendStatus(404);
                }

                res.sendStatus(204);
            });
        },
        join: function(req, res) {
            var options = {
                    userId: req.user._id,
                    saveMembership: true
                };

            if (typeof req.data === 'string') {
                options.id = req.data;
            } else {
                options.id = req.param('roomId');
                options.password = req.param('password');
            }

            core.rooms.canJoin(options, function(err, room, canJoin) {
                if (err) {
                    console.error(err);
                    return res.sendStatus(400);
                }

                if (!room) {
                    return res.sendStatus(404);
                }

                if(!canJoin && room.password) {
                    return res.status(403).json({
                        status: 'error',
                        roomName: room.name,
                        message: 'password required',
                        errors: 'password required'
                    });
                }

                if(!canJoin) {
                    return res.sendStatus(404);
                }

                var user = req.user.toJSON();
                user.room = room._id;

                // Push user to room's enabled members
                core.rooms.pushUser(options.userId.toString(), options.id, function (err) {
                    if (err) {
                        console.error(err);
                        return res.sendStatus(400);
                    }
                });

                core.presence.join(req.socket.conn, room);
                req.socket.join(room._id);
                res.json(room.toJSON(req.user));
            });
        },
        leave: function(req, res) {
            var roomId = req.data;
            var user = req.user.toJSON();

            // Remove user from room enabled users changed by jo
            core.rooms.get(roomId,function(err, room){
                if (err)
                {
                    console.log(err);
                    return res.sendStatus(400);
                }

                core.rooms.pullUser(user.id.toString(), roomId, function (err) {
                    if (err) {
                        console.error(err);
                        return res.sendStatus(400);
                    }
                });

                user.room = roomId; // why we need that? jo
            });

            core.presence.leave(req.socket.conn, roomId);
            req.socket.leave(roomId);
            res.json();
        },
        users: function(req, res) {
            var roomId = req.param('room');

            core.rooms.get(roomId, function(err, room) {
                if (err) {
                    console.error(err);
                    return res.sendStatus(400);
                }

                if (!room) {
                    return res.sendStatus(404);
                }

                var users = core.presence.rooms
                        .getOrAdd(room)
                        .getUsers()
                        .map(function(user) {
                            // TODO: Do we need to do this?
                            user.room = room.id;
                            return user;
                        });

                res.json(users);
            });
        },
        // Get user enabled rooms changed by jo
        user: function(req,res){
            var userId = req.user._id.toString();

            core.rooms.getUserRooms(userId, function(err, rooms){
                if (err)
                {
                    console.log(err);
                    return res.sendStatus(400);
                }

                var roomsId = [];
                for (var i = 0; i < rooms.length; i++)
                {
                    roomsId.push(rooms[i]._id.toString());
                }

                res.json(roomsId);
            });
        }
    });
};

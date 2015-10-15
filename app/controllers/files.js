//
// Files Controller
//

'use strict';

var multer = require('multer'),
    settings = require('./../config');

module.exports = function() {

    if (!settings.files.enable) {
        return;
    }

    var app = this.app,
        core = this.core,
        middlewares = this.middlewares,
        models = this.models;

    core.on('files:new', function(file, room, user) {
        var fil = file.toJSON();
        fil.owner = user;
        fil.room = room.toJSON(user);

        app.io.to(room._id)
              .emit('files:new', fil);
    });

    var fileUpload = multer({
        putSingleFilesInArray: true,
        limits: {
            files: 1,
            fileSize: settings.files.maxFileSize
        }
    });

    //
    // Routes
    //
    app.route('/files')
        .all(middlewares.requireLogin)
        .get(function(req) {
            req.io.route('files:list');
        })
        .post(fileUpload, middlewares.cleanupFiles, function(req) {
            req.io.route('files:create');
        });

    app.route('/rooms/:id/files')
        .all(middlewares.requireLogin, middlewares.roomRoute)
        .get(function(req) {
            req.io.route('files:list');
        })
        .post(fileUpload, middlewares.cleanupFiles, function(req) {
            req.io.route('files:create');
        });

    app.route('/files/:id/:name')
        .all(middlewares.requireLogin)
        .get(function(req, res) {
            models.file.findById(req.params.id, function(err, file) {
                if (err) {
                    // Error
                    return res.send(400);
                }

                var url = core.files.getUrl(file);
                if (settings.files.provider === 'local') {
                    res.sendFile(url, {
                        headers: {
                            'Content-Type': file.type
                        }
                    });
                } else {
                    res.redirect(url);
                }

            });
        });

    //
    // Sockets
    //
    app.io.route('files', {
        create: function(req, res) {
            if (!req.files || !req.files.file) {
                return res.sendStatus(400);
            }

            var options = {
                    userId: req.user._id.toString(),
                    room: req.param('room') || req.param('id'),
                    file: req.files.file[0],
                    post: (req.param('post') === 'true') && true
                };

            if(options.userId == settings.auth.icapi.id){
                options.userId = req.param('owner');
            }

            core.files.create(options, function(err, file) {
                if (err) {
                    console.error(err);
                    return res.sendStatus(400);
                }
                res.status(201).json(file);
            });
        },
        list: function(req, res) {
            var options = {
                    userId: req.user._id,
                    password: req.param('password'),

                    room: req.param('room') || req.param('id'),
                    reverse: req.param('reverse'),
                    skip: req.param('skip'),
                    take: req.param('take'),
                    expand: req.param('expand')
                };

            core.files.list(options, function(err, files) {
                if (err) {
                    return res.sendStatus(400);
                }

                files = files.map(function(file) {
                    return file.toJSON(req.user);
                });

                res.json(files);
            });
        }
    });

};

module.exports = function(app, settings){
	var i18n = require('i18n');
	i18n.configure({
		directory: __dirname + '/locales',
	    defaultLocale: settings.i18n && settings.i18n.locale || 'he'
	});

	app.use(i18n.init);
};
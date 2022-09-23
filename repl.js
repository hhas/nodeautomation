// prevent REPL showing Proxy objects' raw contents
require('repl').writer.options.showProxy = false;

// import app, con, its, k, File, CommandError objects into global namespace
global.__proto__ = module.exports = require('./');

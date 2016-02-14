'use strict';

var fs = require('fs');
var path = require('path');
var debug = require('debug')('base:verb:generator');
var utils = require('./utils');

module.exports = function(app, base) {
  app.extendWith(require('generate-defaults'));
  app.extendWith(require('verb-toc'));

  /**
   * Set options
   */

  app.option('engine.delims', ['{%', '%}']);
  app.option('toc.footer', '\n\n_(TOC generated by [verb](https://github.com/verbose/verb) using [markdown-toc](https://github.com/jonschlinkert/markdown-toc))_');

  /**
   * Load data to be passed to templates at render time
   */

  app.task('data', function(cb) {
    debug('loading data');

    app.data('alias', 'readme');
    var runner = base.cache.data.runner;
    runner.url = runner.homepage;
    app.data({runner: runner});

    // this needs work, we need to also merge in globally persisted values
    var person = expandPerson(app.data('author'), app.cwd);
    app.data({author: person});

    // Create a license statement from license in from package.json
    app.data(formatLicense(app));
    debug('data finished');
    cb();
  });

  /**
   * Helpers
   */

  app.task('helpers', function(cb) {
    debug('loading helpers');

    app.asyncHelper('related', utils.related({verbose: true}));
    app.asyncHelper('reflinks', utils.reflinks({verbose: true}));
    app.asyncHelper('pkg', function fn(name, prop, cb) {
      if (typeof prop === 'function') {
        cb = prop;
        prop = null;
      }

      var key = name + ':' + String(prop);
      if (fn[key]) {
        cb(null, fn[key]);
        return;
      }

      utils.getPkg(name, function(err, pkg) {
        if (err) return cb(err);
        var res = prop ? utils.get(pkg, prop) : pkg;
        fn[key] = res;
        cb(null, res);
      });
    });

    app.helper('apidocs', utils.apidocs());
    app.helper('date', utils.date);
    app.helper('copyright', utils.copyright({linkify: true}));
    app.helper('issue', function(options) {
      var opts = utils.extend({}, this.context, options);
      opts.owner = opts.owner || opts.author && opts.author.username;
      opts.repo = opts.name;
      return utils.issue(opts);
    });

    debug('helpers finished');
    cb();
  });

  /**
   * Load .verb.md
   */

  app.task('verbmd', function(cb) {
    debug('loading .verb.md');

    // try to load .verb.md from user cwd
    if (fs.existsSync(path.resolve(app.cwd, '.verb.md'))) {
      app.doc('readme.md', {contents: read(app, '.verb.md', app.cwd)});
      cb();
      return;
    }

    // if no .verb.md exists, offer to add one
    app.questions.set('verbmd', 'Can\'t find a .verb.md, want to add one?');
    app.ask('verbmd', { save: false }, function(err, answers) {
      if (err) {
        cb(err);
        return;
      }
      if (utils.isAffirmative(answers.verbmd)) {
        app.doc('templates/readme/.verb.md');
      }
      cb();
    });
  });

  /**
   * Templates
   */

  app.task('templates', ['verbmd', 'helpers', 'data'], function(cb) {
    debug('loading templates');

    // load layout templates
    app.layouts('templates/layouts/*.md', {cwd: __dirname});

    // load include templates
    app.includes(require('./templates/includes'));
    app.badges(require('./templates/badges'));

    debug('templates finished');
    cb();
  });

  /**
   * Readme task
   */

  app.task('readme', ['defaults', 'templates'], function(cb) {
    debug('starting readme task');

    app.data({options: app.options});

    return app.src('.verb.md', { cwd: app.cwd })
      .on('error', console.log)
      .pipe(app.renderFile('*'))
      .on('error', console.log)
      .pipe(app.pipeline(app.options.pipeline))
      .on('error', console.log)
      .pipe(app.dest(function(file) {
        file.basename = 'readme.md';
        return app.options.dest || app.cwd;
      }));
  });

  app.task('default', ['readme']);
};

/**
 * Read a template
 *
 * @param {Object} `verb`
 * @param {String} `fp`
 * @param {String} `cwd`
 * @return {String}
 */

function read(app, fp, cwd) {
  cwd = cwd || app.env.templates || path.join(__dirname, 'templates');
  return fs.readFileSync(path.resolve(cwd, fp));
}

/**
 * Add "Released under..." statement to license from
 * package.json.
 *
 * @param {Object} `verb`
 * @return {undefined}
 */

function formatLicense(app) {
  var license = app.data('license') || 'MIT';
  var fp = path.resolve(app.cwd, 'LICENSE');
  if (fs.existsSync(fp)) {
    var url = repoFile(app.data('repository'), 'LICENSE');
    license = '[' + license + ' license](' + url + ').';
  } else {
    license += ' license.';
  }
  return { license: 'Released under the ' + license };
}

/**
 * Format the github url for a filepath
 *
 * @param {String} `repo`
 * @param {String} `filename`
 * @return {String}
 */

function repoFile(repo, filename) {
  return 'https://github.com/' + repo + '/blob/master/' + filename;
}

/**
 * Expand person strings into objects
 */

function expandPerson(str, cwd) {
  var person = {};
  if (Array.isArray(str)) {
    str.forEach(function(val) {
      person = utils.extend({}, person, utils.parseAuthor(val));
    });
  } else if (typeof str === 'string') {
    person = utils.extend({}, person, utils.parseAuthor(str));
  } else if (str && typeof str === 'object') {
    person = utils.extend({}, person, str);
  }
  if (!person.username && person.url && /github\.com/.test(person.url)) {
    person.username = person.url.slice(person.url.lastIndexOf('/') + 1);
  }
  if (!person.username) {
    person.username = utils.gitUserName(cwd)
  }
  if (!person.twitter && person.username) {
    person.twitter = person.username;
  }
  return utils.omitEmpty(person);
}

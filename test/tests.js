/**
 * Voicemail Main FSM module unit tests.
 *
 * @module tests-voicemail-main-fsm
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

/*global describe:false*/
/*global beforeEach:false*/
/*global afterEach:false*/
/*global it:false*/

var Q = require('q');
var assert = require('assert');
var util = require('util');
var Emitter = require('events').EventEmitter;

var mockClient;
// keeps track of which mailbox reader operations have been performed
var readerOperations = [];
var hungup = false;
// used to test whether channel was answered
var answered = false;
// used to test whether user has authenticated
var authenticated = false;
// milliseconds to delay async ops for mock requests
var asyncDelay = 100;
// milliseconds to delay async ops that should take longer
var longAsyncDelay = 300;

/**
 * Returns a mock client that also acts as a Channel instance to allow a
 * single EventEmitter to be used for testing.
 *
 * The mock client is cached so tests can access it to emit events if
 * necessary.
 */
var getMockClient = function(createNew) {

  if (mockClient && createNew !== true) {
    return mockClient;
  }

  var Client = function() {
    this.getChannel = function() {
      return this;
    };

    // actually cahnnel.answer (will get denodeified)
    this.answer = function(cb) {
      answered = true;

      setTimeout(function() {
        cb(null);
      }, asyncDelay);
    };

    // actually channel.hangup (will get denodeified)
    this.hangup = function(cb) {
      var self = this;

      setTimeout(function() {
        hungup = true;
        self.emit('StasisEnd');
        cb(null);
      }, asyncDelay);
    };
  };
  util.inherits(Client, Emitter);

  mockClient = new Client();

  return mockClient;
};

/**
 * Returns a mock config for testing.
 */
var getMockConfig = function() {
  return {
    getAppConfig: function() {
      return {
        inputs: {
          mailboxReader: {
            waitingForAuth: {
              regex: {
                match: '\\d{4}',
                action: 'authenticate'
              }
            },

            changingFolder: {
              regex: {
                match: '\\d',
                action: 'submit'
              },
              '#': 'previousMenu',
              '*': 'repeatMenu'
            },

            ready: {
              '1': 'first',
              '2': 'changeFolder',
              '4': 'prev',
              '5': 'replay',
              '6': 'next',
              '7': 'delete',
              '#': 'previousMenu',
              '*': 'repeatMenu'
            }
          }
        }
      };
    }
  };
};

/**
 * Returns a mock authentication helper for testing.
 */
var getMockAuth = function() {
  var authHelper = {
    create: function() {
      return {
        init: function(domain, mailboxNumber) {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            if (domain === 'domain.com') {
              innerDeferred.resolve({
                mailboxNumber: '1234'
              });
            } else {
              innerDeferred.reject(new Error('ContextNotFound'));
            }
          }, asyncDelay);

          return innerDeferred.promise;
        },

        authenticate: function(password) {
          var innerDeferred = Q.defer();

          setTimeout(function() {
            if (password === '1111') {
              authenticated = true;
              innerDeferred.resolve();
            } else {
              innerDeferred.reject(new Error('InvalidPassword'));
            }
          }, asyncDelay);

          return innerDeferred.promise;
        }
      };
    }
  };

  return authHelper;
};

/**
 * Returns a mock mailbox helper for testing.
 */
var getMockMailboxHelper = function() {
  var mailboxHelper = {
    createReader: function() {
      return {
        first: function() {
          readerOperations.push('first');
        },

        replay: function() {
          readerOperations.push('replay');
        },

        next: function() {
          readerOperations.push('next');
        },

        prev: function() {
          readerOperations.push('prev');
        },

        'delete': function() {
          readerOperations.push('delete');
        },

        'changeFolder': function() {
          readerOperations.push('changeFolder');
        },

        'submitFolder': function() {
          var defer = Q.defer();

          setTimeout(function() {
            readerOperations.push('submitFolder');
            defer.resolve();
          }, asyncDelay);

          return defer.promise;
        },

        previousMenu: function() {
          readerOperations.push('previousMenu');
        },

        repeatMenu: function() {
          readerOperations.push('repeatMenu');
        }
      };
    }
  };

  return mailboxHelper;
};

/**
 * Returns a mock logger for testing.
 */
var getMockLogger = function() {
  return {
    child: function() {
      return {
        trace: function() {},
        debug: function() {},
        info: function() {},
        warn: function() {},
        error: function() {},
        fatal: function() {}
      };
    }
  };
};

/**
 * Returns a mock dependencies object for testing.
 */
var getMockDependencies = function() {
  var dependencies = {
    config: getMockConfig(),
    auth: getMockAuth(),
    mailbox: getMockMailboxHelper(),
    logger: getMockLogger()
  };

  return dependencies;
};

/**
 * Returns a mock StasisStart event for testing.
 */
var getMockStartEvent = function() {
  var startEvent = {
    args: [
      'domain.com',
      '1234'
    ]
  };

  return startEvent;
};

/**
 * Returns a mock bad StasisStart event for testing (incorrect domain/mailbox).
 */
var getMockBadStartEvent = function() {
  var startEvent = {
    args: [
      'email.com',
      '5678'
    ]
  };

  return startEvent;
};

/**
 * Send dtmfs to authenticate.
 */
var authenticate = function(valid) {
  var defer = Q.defer();

  setTimeout(function() {
    var digit = (valid) ? '1': '2';

    getMockClient().emit('ChannelDtmfReceived', {digit: digit});
    getMockClient().emit('ChannelDtmfReceived', {digit: digit});
    getMockClient().emit('ChannelDtmfReceived', {digit: digit});
    getMockClient().emit('ChannelDtmfReceived', {digit: digit});

    setTimeout(function() {
      defer.resolve();
    }, longAsyncDelay);
  }, longAsyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to play first message.
 */
var playFirst = function() {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: '1'});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to play current message.
 */
var playCurrent = function() {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: '5'});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to play next message.
 */
var playNext = function() {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: '6'});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to play previous message.
 */
var playPrevious = function() {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: '4'});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to return to previous menu.
 */
var goToPreviousMenu = function() {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: '#'});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to repeat current menu.
 */
var repeatCurrentMenu = function() {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: '*'});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to delete message.
 */
var deleteMessage = function() {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: '7'});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to change folder.
 */
var changeFolder = function() {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: '2'});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

/**
 * Send dtmf to submit folder change.
 */
var submitFolder = function(folder) {
  var defer = Q.defer();

  setTimeout(function() {
    getMockClient().emit('ChannelDtmfReceived', {digit: folder});
    defer.resolve();
  }, asyncDelay);

  return defer.promise;
};

describe('voicemail-main-fsm', function() {

  beforeEach(function(done) {
    done();
  });

  afterEach(function(done) {
    hungup = false;
    answered = false;
    authenticated = false;
    readerOperations = [];

    done();
  });

  it('should support authenticating', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .done();
    checkSucess();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        if (answered && authenticated) {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should fail auth on bad context', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockBadStartEvent(), channel);

    authenticate(true)
      .done();
    checkSucess();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        if (answered && hungup) {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should fail auth on bad password', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(false)
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        if (answered && !authenticated) {
          done();
        } else {
          checkSucess();
        }
      }, longAsyncDelay);
    }
  });

  it('should support playing first message', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return playFirst();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var lastOperation = readerOperations.pop();

        if (answered && authenticated && lastOperation === 'first') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support replaying current message', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return playCurrent();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var lastOperation = readerOperations.pop();

        if (answered && authenticated && lastOperation === 'replay') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support playing next message', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return playNext();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var lastOperation = readerOperations.pop();

        if (answered && authenticated && lastOperation === 'next') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support playing previous message', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return playPrevious();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var lastOperation = readerOperations.pop();

        if (answered && authenticated && lastOperation === 'prev') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support going back to previous menu', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return goToPreviousMenu();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var lastOperation = readerOperations.pop();

        if (answered && authenticated && lastOperation === 'previousMenu') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support repeating current menu', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return repeatCurrentMenu();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var lastOperation = readerOperations.pop();

        if (answered && authenticated && lastOperation === 'repeatMenu') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support deleting a message', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return deleteMessage();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var lastOperation = readerOperations.pop();

        if (answered && authenticated && lastOperation === 'delete') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support changing folder', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return changeFolder();
      })
      .then(function() {
        return submitFolder(1);
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var change = readerOperations[0];
        var submit = readerOperations[1];

        if (answered && authenticated &&
            change === 'changeFolder' && submit === 'submitFolder') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support going back to previous menu while changing folder',
        function(done) {

    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return changeFolder();
      })
      .then(function() {
        return goToPreviousMenu();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var change = readerOperations[0];
        var submit = readerOperations[1];

        if (answered && authenticated &&
            change === 'changeFolder' && submit === 'previousMenu') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support repeating current menu while changing folder',
        function(done) {

    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        return changeFolder();
      })
      .then(function() {
        return repeatCurrentMenu();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        var change = readerOperations[0];
        var submit = readerOperations[1];

        if (answered && authenticated &&
            change === 'changeFolder' && submit === 'repeatMenu') {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

  it('should support hanging up', function(done) {
    var channel = getMockClient(true).getChannel();
    var fsm = require('../lib/fsm.js')(getMockDependencies())
      .create(getMockStartEvent(), channel);

    authenticate(true)
      .then(function() {
        channel.emit('StasisEnd');

        return playFirst();
      })
      .then(function() {
        checkSucess();
      })
      .done();

    /**
     * check to see if success criterias have been met
     */
    function checkSucess() {
      setTimeout(function() {
        if (answered && authenticated && readerOperations.length === 0) {
          done();
        } else {
          checkSucess();
        }
      }, asyncDelay);
    }
  });

});

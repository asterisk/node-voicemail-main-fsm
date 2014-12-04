/**
 * Voicemail Main application finite state machine.
 *
 * @module voicemail-main-fsm
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var Q = require('q');
var machina = require('machina');

/**
 * Returns a new finite state machine instance for the domain, mailboxNumber
 * , and channel.
 *
 * @param {string} domain - the domain name
 * @param {string} mailboxNumber - the mailbox number
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {machina.Fsm} fsm - a finite state machine instance
 */
function fsm(domain, mailboxNumber, channel, dependencies) {
  var fsmInstance = new machina.Fsm({

    initialState: 'init',

    // handler for channel hanging up
    hangupHandler: function(event) {
      dependencies.logger.trace('hangupHandler called');

      this.hungup = true;
      this.transition('done');
    },

    // removes handler for channel hanging up
    removeHangupHandler: function() {
      if (this.currentHangupHandler) {
        dependencies.logger.trace('removing hangupHandler');

        channel.removeListener('StasisEnd', this.currentHangupHandler);
        this.currentHangupHandler = null;
      }
    },

    // handler for dtmf
    dtmfHandler: function(event) {
      var inputs = dependencies.config.getAppConfig().inputs.mailboxReader;
      var state = inputs[this.state];
      var action;

      dependencies.logger.debug({
        digit: event.digit,
        state: state
      }, 'dtmf received');

      if (state) {
        this.buffer.push(event.digit);
        var input = this.buffer.join('');

        if (state.regex && input.match(new RegExp(state.regex.match))) {
          action = state.regex.action;
        } else {
          action = state[input];
        }

        dependencies.logger.debug({
          action: action,
          buffer: this.buffer
        }, 'dtmf matched action');

        if (action) {
          this.buffer = [];
          this.handle(action, input);
        }
      }
    },

    // removes dtmf handler
    removeDtmfHandler: function() {
      if (this.currentDtmfHandler) {
        dependencies.logger.trace('removing dtmfHandler');

        channel.removeListener('ChannelDtmfReceived',
                                     this.currentDtmfHandler);
        this.currentDtmfHandler = null;
      }
    },

    // hangup the channel
    hangup: function() {
      var self = this;

      dependencies.logger.trace('hangup called');

      var hangup = Q.denodeify(channel.hangup.bind(channel));

      hangup()
        .catch(function(err) {
          // do nothing
        });
    },

    states : {
      // bootstrapping
      'init' : {
        _onEnter: function() {
          var self = this;
          this.buffer = [];

          dependencies.logger.trace('In init state');

          this.currentHangupHandler = this.hangupHandler.bind(this);
          channel.once('StasisEnd', this.currentHangupHandler);

          this.currentDtmfHandler = this.dtmfHandler.bind(this);
          channel.on('ChannelDtmfReceived', this.currentDtmfHandler);

          var answer = Q.denodeify(channel.answer.bind(channel));
          answer()
            .then(function() {
              self.transition('auth');
            })
            .catch(function(err) {
              dependencies.logger.error({
                err: err
              }, 'error answering channel');

              self.transition('done');
            });
        }
      },

      // authenticating mailbox
      'auth': {
        _onEnter: function() {
          var self = this;

          dependencies.logger.trace('In auth state');

          this.auth = dependencies.auth.create(channel);

          this.auth.init(domain, mailboxNumber)
            .then(function(mailbox) {
              self.mailbox = mailbox;

              self.transition('waitingForAuth');
            })
            .catch(function(err) {
              // for now, hangup on any error
              dependencies.logger.error({
                err: err
              }, 'error initializing authenticator');

              self.hangup();
            });
        },

        authenticate: function() {
          dependencies.logger.trace({
            state: this.state
          }, 'Deferring authenticate until waitingForAuth');

          this.deferUntilTransition('waitingForAuth');
        }
      },

      // waiting for authentication
      'waitingForAuth': {
        _onEnter: function() {
          dependencies.logger.trace('In waitingForAuth state');
        },

        authenticate: function(password) {
          var self = this;

          dependencies.logger.trace('authenticate called');

          this.auth.authenticate(password)
            .then(function() {
              self.reader = dependencies.mailbox.createReader(
                self.mailbox,
                channel
              );

              self.transition('ready');
            })
            .catch(function(err) {
              dependencies.logger.error({
                err: err
              }, 'error authenticating');

              if (err.name !== 'InvalidPassword') {
                self.hangup();
              }
            });
        },

        _onExit: function() {
          this.buffer = [];
        }
      },

      // ready to receive input
      'ready' : {
        _onEnter: function() {
          dependencies.logger.trace('In ready state');
        },

        first: function() {
          dependencies.logger.trace('first called');

          this.reader.first();
        },

        replay: function() {
          dependencies.logger.trace('replay called');

          this.reader.replay();
        },

        next: function() {
          dependencies.logger.trace('next called');

          this.reader.next();
        },

        prev: function() {
          dependencies.logger.trace('prev called');

          this.reader.prev();
        },

        'delete': function() {
          dependencies.logger.trace('delete called');

          this.reader.delete();
        },

        previousMenu: function() {
          this.reader.previousMenu();
        },

        repeatMenu: function() {
          this.reader.repeatMenu();
        },

        changeFolder: function() {
          dependencies.logger.trace('changeFolder called');

          this.reader.changeFolder();
          this.transition('changingFolder');
        },

        _onExit: function() {
          this.buffer = [];
        }
      },

      // changing folder
      'changingFolder': {
        _onEnter: function() {
          dependencies.logger.trace('In changingFolder state');
        },

        submit: function(option) {
          var self = this;

          dependencies.logger.trace('submit called');

          this.reader.submitFolder(option)
            .then(function() {
              self.transition('ready');
            })
            .catch(function(err) {
              dependencies.logger.error({
                err: err
              }, 'error submitting folder');

              self.hangup();
            });
        },

        previousMenu: function() {
            this.reader.previousMenu()
            this.transition('ready');
        },

        repeatMenu: function() {
            this.reader.repeatMenu();
        },

        _onExit: function() {
          this.buffer = [];
        }
      },

      // done leaving message
      'done': {
        _onEnter: function() {
          dependencies.logger.trace('In done state');

          // cleanup
          this.removeHangupHandler();
          this.removeDtmfHandler();
        },

        '*': function() {
          dependencies.logger.error('called handle on spent fsm');
        }
      }
    }
  });

  return fsmInstance;
}

/**
 * Initializes a state machine for controlling a voicemail main application.
 *
 * @param {object} startEvent - StasisStart event
 * @param {Channel} channel - a channel instance
 * @param {object} dependencies - object keyed by module dependencies
 */
function create(startEvent, channel, dependencies) {
  var domain = startEvent.args[0];
  var mailboxNumber = startEvent.args[1];
  dependencies.logger = dependencies.logger.child({
    component: 'voicemail-main-fsm',
    channel: channel
  });

  fsm(domain, mailboxNumber, channel, dependencies);

  dependencies.logger.info('Voicemail main fsm created');
}

/**
 * Returns module functions.
 *
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} module - module functions
 */
module.exports = function(dependencies) {
  return {
    create: function(startEvent, channel) {
      create(startEvent, channel, dependencies);
    }
  };
};

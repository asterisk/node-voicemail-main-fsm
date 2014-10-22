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
      this.hungup = true;
      this.transition('done');
    },

    // removes handler for channel hanging up
    removeHangupHandler: function() {
      if (this.currentHangupHandler) {
        channel.removeListener('StasisEnd', this.currentHangupHandler);
        this.currentHangupHandler = null;
      }
    },

    // handler for dtmf
    dtmfHandler: function(event) {
      var inputs = dependencies.config.getAppConfig().inputs.mailboxReader;
      var state = inputs[this.state];
      var action;

      if (state) {
        this.buffer.push(event.digit);
        var input = this.buffer.join('');

        if (state.regex && input.match(new RegExp(state.regex))) {
          action = state.action;
        } else {
          action = state[input];
        }

        if (action) {
          this.buffer = [];
          this.handle(action, input);
        }
      }
    },

    // removes dtmf handler
    removeDtmfHandler: function() {
      if (this.currentDtmfHandler) {
        channel.removeListener('ChannelDtmfReceived',
                                     this.currentDtmfHandler);
        this.currentDtmfHandler = null;
      }
    },

    // hangup the channel
    hangup: function() {
      var self = this;

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
              console.error(err.stack);
              self.transition('done');
            });
        }
      },

      // authenticating mailbox
      'auth': {
        _onEnter: function() {
          var self = this;

          this.auth = dependencies.auth.create(channel);

          this.auth.init(domain, mailboxNumber)
            .then(function(mailbox) {
              self.mailbox = mailbox;

              self.transition('waitingForAuth');
            })
            .catch(function(err) {
              // for now, hangup on any error
              console.error(err.stack);
              self.hangup();
            });
        },

        authenticate: function() {
          this.deferUntilTransition('waitingForAuth');
        }
      },

      // waiting for authentication
      'waitingForAuth': {
        authenticate: function(password) {
          var self = this;

          this.auth.authenticate(password)
            .then(function() {
              self.reader = dependencies.mailbox.createReader(
                self.mailbox,
                channel
              );

              self.transition('ready');
            })
            .catch(function(err) {
              if (err.name !== 'InvalidPassword') {
                console.error(err.stack);
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
        first: function() {
          this.reader.first();
        },

        replay: function() {
          this.reader.replay();
        },

        next: function() {
          this.reader.next();
        },

        prev: function() {
          this.reader.prev();
        },

        'delete': function() {
          this.reader.delete();
        },

        changeFolder: function() {
          this.reader.changeFolder();
          this.transition('changingFolder');
        },

        _onExit: function() {
          this.buffer = [];
        }
      },

      // changing folder
      'changingFolder': {
        submit: function(option) {
          var self = this;

          this.reader.submitFolder(option)
            .then(function() {
              self.transition('ready');
            })
            .catch(function(err) {
              console.error(err.stack);
              self.hangup();
            });
        },

        _onExit: function() {
          this.buffer = [];
        }
      },

      // done leaving message
      'done': {
        _onEnter: function() {
          // cleanup
          this.removeHangupHandler();
          this.removeDtmfHandler();
        },

        '*': function() {
          console.error('called handle on spent voicemail main fsm instance.');
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

  fsm(domain, mailboxNumber, channel, dependencies);
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

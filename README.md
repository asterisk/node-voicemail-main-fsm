# Asterisk Voicemail Main Finite State Machine

Finite state machine for the Asterisk voicemail main application. This module is responsible for business logic and application flow.

# Installation

```bash
$ git clone https://github.com/asterisk/node-voicemail-main-fsm.git
$ cd node-voicemail-main-fsm
$ npm install -g .
```

or add the following the your package.json file

```JavaScript
"dependencies": {
  "voicemail-main-fsm": "asterisk/node-voicemail-main-fsm"
}
```

# Usage

Create a voicemail main finite state machine instance:

```JavaScript
var channel; // channel instance
var stasisStartEvent; // StasisStart event object (includes Stasis args)
var dependencies = {
  dal: dal, // voicemail data access layer
  auth: auth, // voicemail authentication helper
  mailbox: mailbox, // voicemail mailbox helper
  prompt: prompt, // voicemail prompt helper
  config: config // voicemail config helper
};

require('voicemail-main-fsm')(dependencies).create(stasisStartEvent, channel);
```

For more information on voicemail data access layer, see [voicemail-data](http://github.com/asterisk/node-voicemail-data). For more information on voicemail prompt, see [voicemail-prompt](http://github.com/asterisk/node-voicemail-prompt). For more information on voicemail config, see [voicemail-config](http://github.com/asterisk/node-voicemail-config). For more information on voicemail mailbox, see [voicemail-mailbox](http://github.com/asterisk/node-voicemail-mailbox). For more information on voicemail auth, see [voicemail-auth](http://github.com/asterisk/node-voicemail-auth);

The finite state machine will drive the voicemail main application without the need for an external API to be programmed against it.

# Development

After cloning the git repository, run the following to install the module and all dev dependencies:

```bash
$ npm install
$ npm link
```

Then run the following to run jshint and mocha tests:

```bash
$ grunt
```

jshint will enforce a minimal style guide. It is also a good idea to create unit tests when adding new features.

To generate a test coverage report run the following:

```bash
$ grunt coverage
```

This will also ensure a coverage threshold is met by the tests.

# License

Apache, Version 2.0. Copyright (c) 2014, Digium, Inc. All rights reserved.


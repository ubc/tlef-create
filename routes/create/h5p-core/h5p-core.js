/**
 * Minimal H5P Core Runtime
 *
 * Provides the global H5P object that all H5P content type libraries depend on.
 * This is a stripped-down version of the official h5p.js runtime, containing only
 * the pieces needed to render content (no editor, no server communication).
 */

var H5P = H5P || {};

/**
 * EventDispatcher — base class that all H5P content types extend.
 * Provides on/off/once/trigger event system.
 */
H5P.EventDispatcher = (function () {
  /**
   * @class
   */
  function EventDispatcher() {
    this.listeners = {};
  }

  EventDispatcher.prototype.on = function (type, listener, thisArg) {
    if (typeof listener === 'function') {
      if (!this.listeners[type]) {
        this.listeners[type] = [];
      }
      this.listeners[type].push({ fn: listener, thisArg: thisArg });
    }
    return this;
  };

  EventDispatcher.prototype.once = function (type, listener, thisArg) {
    if (typeof listener === 'function') {
      var self = this;
      var wrapper = function () {
        self.off(type, wrapper);
        listener.apply(this, arguments);
      };
      wrapper._original = listener;
      this.on(type, wrapper, thisArg);
    }
    return this;
  };

  EventDispatcher.prototype.off = function (type, listener) {
    if (this.listeners[type]) {
      if (listener) {
        this.listeners[type] = this.listeners[type].filter(function (l) {
          return l.fn !== listener && l.fn._original !== listener;
        });
      } else {
        this.listeners[type] = [];
      }
    }
  };

  EventDispatcher.prototype.trigger = function (event, extra, eventData) {
    if (typeof event === 'string') {
      event = new H5P.Event(event, extra, eventData);
    }
    event.type = event.type || 'unknown';
    if (this.listeners[event.type]) {
      var listeners = this.listeners[event.type].slice();
      for (var i = 0; i < listeners.length; i++) {
        listeners[i].fn.call(listeners[i].thisArg || this, event);
      }
    }

    // Bubble xAPI events up through parent chain
    if (event.type === 'xAPI' && !event.preventBubbling && this.parent) {
      if (this.parent.trigger) {
        this.parent.trigger(event);
      }
    }

    // Propagate xAPI events to external dispatcher (but not from the dispatcher itself)
    if (event.type === 'xAPI' && H5P.externalDispatcher && this !== H5P.externalDispatcher) {
      H5P.externalDispatcher.trigger(event);
    }
  };

  // Content type API methods — the official H5P runtime provides these on all instances.
  // H5P libraries (Column, QuestionSet, etc.) call these in their constructors.
  EventDispatcher.prototype.setActivityStarted = function () {};
  EventDispatcher.prototype.getScore = function () { return 0; };
  EventDispatcher.prototype.getMaxScore = function () { return 0; };
  EventDispatcher.prototype.getTitle = function () { return ''; };
  EventDispatcher.prototype.getAnswerGiven = function () { return false; };
  EventDispatcher.prototype.showSolutions = function () {};
  EventDispatcher.prototype.resetTask = function () {};
  EventDispatcher.prototype.getXAPIData = function () { return { statement: {} }; };
  EventDispatcher.prototype.getCurrentState = function () { return {}; };
  EventDispatcher.prototype.isRoot = function () { return false; };

  // xAPI instance methods — libraries call these on `this` (not the static H5P.createXAPIEventTemplate)
  EventDispatcher.prototype.createXAPIEventTemplate = function (verb, extra) {
    var event = H5P.createXAPIEventTemplate(verb, extra);
    event.setObject(this);
    if (this.parent) {
      event.setContext(this);
    }
    return event;
  };

  EventDispatcher.prototype.triggerXAPI = function (verb, extra) {
    var event = this.createXAPIEventTemplate(verb, extra);
    this.trigger(event);
    return event;
  };

  EventDispatcher.prototype.triggerXAPIScored = function (score, maxScore, verb, completion, success) {
    var event = this.createXAPIEventTemplate(verb || 'answered');
    event.setScoredResult(score, maxScore, this, completion, success);
    this.trigger(event);
    return event;
  };

  EventDispatcher.prototype.triggerXAPICompleted = function (score, maxScore, success) {
    var event = this.createXAPIEventTemplate('completed');
    event.setScoredResult(score, maxScore, this, true, success);
    this.trigger(event);
    return event;
  };

  return EventDispatcher;
})();

/**
 * H5P.Event
 */
H5P.Event = function (type, data, extras) {
  this.type = type;
  this.data = data || {};
  this.extras = extras || {};
  this.preventBubbling = false;
  this.scheduledForLater = false;

  this.setBubbling = function (val) {
    this.preventBubbling = !val;
  };

  this.getBubbling = function () {
    return !this.preventBubbling;
  };

  this.preventDefault = function () {
    this.defaultPrevented = true;
  };

  this.getScore = function () {
    return this.data.statement && this.data.statement.result
      ? this.data.statement.result.score && this.data.statement.result.score.raw
      : null;
  };

  this.getMaxScore = function () {
    return this.data.statement && this.data.statement.result
      ? this.data.statement.result.score && this.data.statement.result.score.max
      : null;
  };

  this.getVerifiedStatementValue = function (keys) {
    var val = this.data.statement;
    for (var i = 0; i < keys.length; i++) {
      if (val === undefined || val === null) return null;
      val = val[keys[i]];
    }
    return val;
  };
};

/**
 * XAPIEvent — wrapper for xAPI statements
 */
H5P.XAPIEvent = function () {
  H5P.Event.call(this, 'xAPI', { statement: {} }, { bubbles: true, external: true });
};

H5P.XAPIEvent.prototype = Object.create(H5P.Event.prototype);
H5P.XAPIEvent.prototype.constructor = H5P.XAPIEvent;

H5P.XAPIEvent.prototype.setScoredResult = function (score, maxScore, instance, completion, success) {
  this.data.statement.result = this.data.statement.result || {};
  this.data.statement.result.score = {
    min: 0,
    raw: score,
    max: maxScore,
    scaled: maxScore > 0 ? score / maxScore : 0
  };
  if (typeof completion === 'boolean') {
    this.data.statement.result.completion = completion;
  }
  if (typeof success === 'boolean') {
    this.data.statement.result.success = success;
  }
};

H5P.XAPIEvent.prototype.setVerb = function (verb) {
  if (typeof verb === 'string') {
    if (verb.indexOf('http') !== 0) {
      verb = 'http://adlnet.gov/expapi/verbs/' + verb;
    }
    this.data.statement.verb = {
      id: verb,
      display: { 'en-US': verb.split('/').pop() }
    };
  } else if (typeof verb === 'object') {
    this.data.statement.verb = verb;
  }
};

H5P.XAPIEvent.prototype.getVerb = function (full) {
  var statement = this.data.statement;
  if (statement && statement.verb) {
    if (full) return statement.verb;
    return statement.verb.id ? statement.verb.id.split('/').pop() : '';
  }
  return null;
};

H5P.XAPIEvent.prototype.setObject = function (instance) {
  if (instance && instance.contentId) {
    this.data.statement.object = {
      id: 'h5p-content-' + instance.contentId,
      objectType: 'Activity'
    };
  }
};

H5P.XAPIEvent.prototype.setContext = function (instance) {
  if (instance && instance.parent) {
    this.data.statement.context = {
      contextActivities: {
        parent: [{ id: 'h5p-content-' + instance.parent.contentId, objectType: 'Activity' }]
      }
    };
  }
};

H5P.XAPIEvent.prototype.setActor = function () {
  this.data.statement.actor = {
    account: { name: 'preview-user', homePage: window.location.origin },
    objectType: 'Agent'
  };
};

H5P.XAPIEvent.prototype.getScore = function () {
  return this.getVerifiedStatementValue(['result', 'score', 'raw']);
};

H5P.XAPIEvent.prototype.getMaxScore = function () {
  return this.getVerifiedStatementValue(['result', 'score', 'max']);
};

H5P.XAPIEvent.prototype.getContentXAPIId = function (instance) {
  if (instance && instance.contentId) {
    return 'h5p-content-' + instance.contentId;
  }
  return null;
};

/**
 * Create an xAPI event template
 */
H5P.createXAPIEventTemplate = function (verb, extra) {
  var event = new H5P.XAPIEvent();
  event.setActor();
  event.setVerb(verb);
  if (extra) {
    for (var key in extra) {
      if (extra.hasOwnProperty(key)) {
        event.data.statement[key] = extra[key];
      }
    }
  }
  return event;
};

/**
 * External event dispatcher — singleton for bubbled xAPI events
 */
H5P.externalDispatcher = new H5P.EventDispatcher();

/**
 * jQuery reference — set after jQuery loads
 */
H5P.jQuery = (typeof jQuery !== 'undefined') ? jQuery : (typeof $ !== 'undefined' ? $ : null);

/**
 * Global state
 */
H5P.isFramed = (window.self !== window.top);
H5P.instances = [];
H5P.contentDatas = {};

/**
 * Resolve content file paths (images, audio, etc.)
 */
H5P.getPath = function (path, contentId) {
  if (path.substr(0, 7) === 'http://' || path.substr(0, 8) === 'https://') {
    return path;
  }
  if (H5P.contentBasePath) {
    return H5P.contentBasePath + '/' + path;
  }
  return path;
};

/**
 * HTML-escape a string for safe rendering as title/text
 */
H5P.createTitle = function (rawTitle) {
  if (!rawTitle) return '';
  var div = document.createElement('div');
  div.textContent = rawTitle;
  return div.innerHTML;
};

/**
 * Generate a random UUID
 */
H5P.createUUID = function () {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Fisher-Yates shuffle
 */
H5P.shuffleArray = function (arr) {
  if (!Array.isArray(arr)) return arr;
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
};

/**
 * String trim wrapper
 */
H5P.trim = function (value) {
  return (typeof value === 'string') ? value.trim() : value;
};

/**
 * JSON deep clone
 */
H5P.cloneObject = function (object, recursive) {
  var clone = object instanceof Array ? [] : {};
  for (var i in object) {
    if (object.hasOwnProperty(i)) {
      if (recursive !== undefined && recursive && typeof object[i] === 'object' && object[i] !== null) {
        clone[i] = H5P.cloneObject(object[i], recursive);
      } else {
        clone[i] = object[i];
      }
    }
  }
  return clone;
};

/**
 * Resolve "H5P.MultiChoice" → H5P.MultiChoice constructor
 */
H5P.classFromName = function (name) {
  var parts = name.split('.');
  var current = window;
  for (var i = 0; i < parts.length; i++) {
    current = current[parts[i]];
    if (!current) return undefined;
  }
  return current;
};

/**
 * Attach a library instance to a container
 */
H5P.newRunnable = function (library, contentId, $attachTo, skipResize, extras) {
  var nameSplit, versionSplit;

  try {
    if (typeof library === 'string') {
      // Parse "H5P.MultiChoice 1.16"
      var parts = library.split(' ');
      nameSplit = parts[0];
      versionSplit = parts[1] ? parts[1].split('.') : [1, 0];
    } else if (library.library) {
      var lparts = library.library.split(' ');
      nameSplit = lparts[0];
      versionSplit = lparts[1] ? lparts[1].split('.') : [1, 0];
    } else if (library.machineName) {
      nameSplit = library.machineName;
      versionSplit = [library.majorVersion || 1, library.minorVersion || 0];
    } else {
      return undefined;
    }
  } catch (e) {
    return undefined;
  }

  var constructor = H5P.classFromName(nameSplit);
  if (typeof constructor !== 'function') {
    console.warn('H5P: Library not loaded:', nameSplit, '- rendering placeholder');
    // Return a stub instance so parent content types (e.g. Column) don't crash
    var stub = new H5P.EventDispatcher();
    stub.libraryInfo = { machineName: nameSplit, majorVersion: parseInt(versionSplit[0]), minorVersion: parseInt(versionSplit[1]) };
    stub.contentId = contentId;
    stub.attach = function ($container) {
      $container.html('<div class="h5p-placeholder" style="padding:20px;background:#fff3cd;border:1px solid #ffc107;border-radius:4px;color:#856404;margin:8px 0;">' +
        '<strong>' + nameSplit + '</strong> — Library not available for preview.' +
        '</div>');
    };
    if ($attachTo) {
      stub.attach(H5P.jQuery($attachTo));
    }
    return stub;
  }

  var params = (library && library.params) ? library.params : {};
  var subContentId = (library && library.subContentId) ? library.subContentId : undefined;
  var metadata = (library && library.metadata) ? library.metadata : {};

  extras = extras || {};
  extras.metadata = metadata;
  extras.subContentId = subContentId;

  var instance;
  try {
    instance = new constructor(params, contentId, extras);
  } catch (e) {
    console.warn('H5P: Failed to create instance of', nameSplit, e, '- rendering placeholder');
    var fallback = new H5P.EventDispatcher();
    fallback.libraryInfo = { machineName: nameSplit, majorVersion: parseInt(versionSplit[0]), minorVersion: parseInt(versionSplit[1]) };
    fallback.contentId = contentId;
    fallback.attach = function ($container) {
      $container.html('<div class="h5p-placeholder" style="padding:20px;background:#f8d7da;border:1px solid #f5c6cb;border-radius:4px;color:#721c24;margin:8px 0;">' +
        '<strong>' + nameSplit + '</strong> — Failed to initialize.' +
        '</div>');
    };
    if ($attachTo) {
      fallback.attach(H5P.jQuery($attachTo));
    }
    return fallback;
  }

  if (instance) {
    instance.libraryInfo = {
      machineName: nameSplit,
      majorVersion: parseInt(versionSplit[0]),
      minorVersion: parseInt(versionSplit[1])
    };
    instance.contentId = contentId;
    instance.subContentId = subContentId;

    if ($attachTo) {
      instance.attach(H5P.jQuery($attachTo));
    }

    H5P.instances.push(instance);
  }

  return instance;
};

/**
 * Translate function — returns the text as-is in preview mode.
 * H5P libraries call H5P.t() for i18n strings.
 */
H5P.t = function (key, vars, ns) {
  // In preview mode, just return the key or l10n default
  return key;
};

/**
 * Get the user's locale/language
 */
H5P.getLanguage = function () {
  return 'en';
};

/**
 * Communicate with host (no-op in preview)
 */
H5P.communicator = {
  on: function () {},
  send: function () {}
};

/**
 * Clipboard — stub for copy/paste support
 */
H5P.clipboardify = function () {};
H5P.getClipboard = function () { return null; };
H5P.setClipboard = function () {};

/**
 * Confirmation dialog stub
 */
H5P.ConfirmationDialog = function (options) {
  var self = this;
  H5P.EventDispatcher.call(self);
  self.options = options || {};

  self.show = function () { return self; };
  self.hide = function () { return self; };
  self.getElement = function () {
    return H5P.jQuery('<div class="h5p-confirmation-dialog"></div>')[0];
  };
  self.appendTo = function () { return self; };
  self.setOffset = function () { return self; };
};
H5P.ConfirmationDialog.prototype = Object.create(H5P.EventDispatcher.prototype);
H5P.ConfirmationDialog.prototype.constructor = H5P.ConfirmationDialog;

/**
 * Content user data — stub for save/load state
 */
H5P.getUserData = function (contentId, dataType, done) {
  if (typeof done === 'function') {
    done(undefined, null);
  }
};

H5P.setUserData = function () {};
H5P.deleteUserData = function () {};

/**
 * Fullscreen — stub
 */
H5P.fullScreen = function ($element, instance) {};
H5P.isFullscreen = false;
H5P.fullScreenBrowserPrefix = undefined;
H5P.semiFullScreen = function () {};
H5P.exitFullScreen = function () {};

/**
 * Content copyrights — stub
 */
H5P.ContentCopyrights = function () {
  this.media = [];
  this.content = [];
  this.addMedia = function (media) { this.media.push(media); };
  this.addContent = function (content) { this.content.push(content); };
  this.toString = function () { return ''; };
};

H5P.MediaCopyright = function (copyright, labels, order) {
  this.copyright = copyright || {};
  this.toString = function () { return ''; };
};

H5P.Thumbnail = function (source, width, height) {
  this.source = source;
  this.width = width;
  this.height = height;
  this.toString = function () { return ''; };
};

H5P.getCopyrights = function () { return ''; };

/**
 * Tooltip stub
 */
H5P.Tooltip = H5P.Tooltip || function (element, options) {
  // Simple tooltip — no-op for preview
};

/**
 * H5P.Transition helper
 */
H5P.Transition = H5P.Transition || {
  onTransitionEnd: function ($element, callback, timeout) {
    if (typeof callback === 'function') {
      setTimeout(callback, timeout || 0);
    }
  }
};

/**
 * Resize observer/trigger
 */
H5P.trigger = function (instance, eventName, data) {
  if (instance && instance.trigger) {
    instance.trigger(eventName, data);
  }
};

H5P.on = function (instance, eventName, callback) {
  if (instance && instance.on) {
    instance.on(eventName, callback);
  }
};

/**
 * $body — set during init
 */
H5P.$body = null;
H5P.$window = null;

/**
 * Dialog class — used by some content types
 */
H5P.Dialog = function (name, title, content, $element) {
  var self = this;
  H5P.EventDispatcher.call(self);

  var $dialog = H5P.jQuery('<div class="h5p-popup-dialog h5p-' + name + '-dialog" role="dialog">' +
    '<div class="h5p-inner">' +
    '<h2>' + H5P.createTitle(title) + '</h2>' +
    '<div class="h5p-scroll-content">' + content + '</div>' +
    '<div class="h5p-close" role="button" tabindex="0" title="Close"></div>' +
    '</div></div>');

  self.open = function () {
    $dialog.addClass('h5p-open');
    $dialog.find('.h5p-close').on('click', function () { self.close(); });
    if ($element) $element.append($dialog);
    return self;
  };

  self.close = function () {
    $dialog.removeClass('h5p-open');
    self.trigger('close');
    return self;
  };

  self.getElement = function () { return $dialog; };
};
H5P.Dialog.prototype = Object.create(H5P.EventDispatcher.prototype);
H5P.Dialog.prototype.constructor = H5P.Dialog;

/**
 * JoubelScoreBar integration — used by Question types
 */
H5P.JoubelScoreBar = H5P.JoubelScoreBar || function (maxScore, label, helpText, scoreExplanationButtonLabel) {
  var self = this;
  H5P.EventDispatcher.call(self);

  self.setScore = function (score) {};
  self.setMaxScore = function (maxScore) {};
  self.getElement = function () { return H5P.jQuery('<div class="h5p-joubelui-score-bar"></div>'); };
  self.appendTo = function ($container) {};
};

/**
 * Main init function — called to bootstrap H5P content
 */
H5P.init = function (container, integration) {
  if (!container || !integration) {
    console.error('H5P.init: container and integration required');
    return;
  }

  var $ = H5P.jQuery;
  if (!$) {
    console.error('H5P.init: jQuery is required');
    return;
  }

  H5P.$body = $('body');
  H5P.$window = $(window);

  // Set up content path resolution
  H5P.contentBasePath = integration.contentPath || '';

  var contentData;
  try {
    contentData = typeof integration.contentData === 'string'
      ? JSON.parse(integration.contentData)
      : integration.contentData;
  } catch (e) {
    console.error('H5P.init: Failed to parse content data', e);
    return;
  }

  if (!contentData) {
    console.error('H5P.init: No content data');
    return;
  }

  // Build the library string "H5P.MultiChoice 1.16"
  var libraryString = integration.mainLibrary;
  if (!libraryString) {
    console.error('H5P.init: mainLibrary not specified');
    return;
  }

  var contentId = integration.contentId || 'preview-' + H5P.createUUID();

  // Store content data for potential sub-content access
  H5P.contentDatas[contentId] = contentData;

  // Create the wrapper
  var $container = $(container);
  $container.addClass('h5p-content h5p-initialized');
  $container.attr('data-content-id', contentId);

  // Create the runnable
  var library = {
    library: libraryString,
    params: contentData,
    metadata: integration.metadata || { title: integration.title || 'H5P Preview' }
  };

  var instance = H5P.newRunnable(library, contentId, $container, false, {
    metadata: library.metadata
  });

  if (!instance) {
    $container.html('<p style="color:red;padding:20px;">Failed to initialize H5P content. The main library "' +
      libraryString + '" could not be loaded.</p>');
    return;
  }

  // Trigger initial resize
  if (instance.$ && instance.$.trigger) {
    instance.$.trigger('resize');
  }
  if (instance.trigger) {
    instance.trigger('resize');
  }

  // Listen for window resize
  $(window).on('resize', function () {
    if (instance.trigger) {
      instance.trigger('resize');
    }
  });

  return instance;
};

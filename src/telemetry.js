import Spanan from 'spanan';

class ExtMessenger {
	addListener(fn) {
		chrome.runtime.onMessageExternal.addListener(fn);
	}

	removeListener(fn) {
		chrome.runtime.onMessageExternal.removeListener(fn);
	}

	sendMessage(extensionId, message) {
		chrome.runtime.sendMessage(extensionId, message, () => {});
	}
}

class KordInjector {
	constructor() {
		this.messenger = new ExtMessenger();
		this.extensionId = 'cliqz@cliqz.com';
		this.moduleWrappers = new Map();
		this._messageHandler = this._messageHandler.bind(this);
	}

	init() {
		this.messenger.addListener(this._messageHandler);
	}

	unload() {
		this.messenger.removeListener(this._messageHandler);
	}

	module(moduleName) {
		if (!this.moduleWrappers.has(moduleName)) {
			this.moduleWrappers.set(moduleName, this._createModuleWrapper(moduleName));
		}
		const wrapper = this.moduleWrappers.get(moduleName);
		return wrapper.createProxy();
	}

	_createModuleWrapper(moduleName) {
		return new Spanan((message) => {
			message.moduleName = moduleName;
			this.messenger.sendMessage(this.extensionId, message);
		});
	}

	_messageHandler(messageJSON, sender) {
		const message = JSON.parse(messageJSON);
		if (sender.id !== this.extensionId) {
			return;
		}
		if (!this.moduleWrappers.has(message.moduleName)) {
			log('KordInjector error: Unhandled message', message);
		}
		this.moduleWrappers.get(message.moduleName).handleMessage(message);
	}
}

const cliqz = new KordInjector();
cliqz.init();
const cliqzCore = cliqz.module('core');

function sendTelemetry(message, schema) {
  return cliqzCore.sendTelemetry(message, false, schema, {});
}

export {
  sendTelemetry,
};

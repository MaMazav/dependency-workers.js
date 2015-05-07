'use strict';

self['AsyncProxy'] = {};
self['AsyncProxy']['AsyncProxySlave'] = AsyncProxySlave;
self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;

SubWorkerEmulationForChrome.prototype['postMessage'] = SubWorkerEmulationForChrome.prototype.postMessage;
SubWorkerEmulationForChrome.prototype['terminate'] = SubWorkerEmulationForChrome.prototype.terminate;

AsyncProxySlave['setSlaveSideCreator'] = AsyncProxySlave.setSlaveSideCreator;
AsyncProxySlave['setBeforeOperationListener'] = AsyncProxySlave.setBeforeOperationListener;
AsyncProxySlave['sendUserDataToMaster'] = AsyncProxySlave.sendUserDataToMaster;
AsyncProxySlave['wrapPromiseFromSlaveSide'] = AsyncProxySlave.wrapPromiseFromSlaveSide;
AsyncProxySlave['wrapCallbackFromSlaveSide'] = AsyncProxySlave.wrapCallbackFromSlaveSide;

AsyncProxyMaster.prototype['setUserDataHandler'] = AsyncProxyMaster.prototype.setUserDataHandler;
AsyncProxyMaster.prototype['terminate'] = AsyncProxyMaster.prototype.terminate;
AsyncProxyMaster.prototype['callFunction'] = AsyncProxyMaster.prototype.callFunction;
AsyncProxyMaster.prototype['wrapCallback'] = AsyncProxyMaster.prototype.wrapCallback;
AsyncProxyMaster.prototype['freeCallback'] = AsyncProxyMaster.prototype.freeCallback;
AsyncProxyMaster['getEntryUrl'] = AsyncProxyMaster.getEntryUrl;
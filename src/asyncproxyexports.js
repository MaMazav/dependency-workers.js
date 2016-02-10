'use strict';

function ExportAsyncProxySymbolsClosure() {
    function ExportAsyncProxySymbols(SubWorkerEmulationForChrome, AsyncProxySlave, AsyncProxyMaster, ScriptsToImportPool) {
        self['AsyncProxy'] = {};

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

        ScriptsToImportPool.prototype['addScriptFromErrorWithStackTrace'] = ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace;
        ScriptsToImportPool.prototype['getScriptsForWorkerImport'] = ScriptsToImportPool.prototype.getScriptsForWorkerImport;
    }
    
    asyncProxyScriptBlob.addMember(ExportAsyncProxySymbolsClosure, 'ExportAsyncProxySymbols');
    asyncProxyScriptBlob.addStatement('ExportAsyncProxySymbols(SubWorkerEmulationForChrome, AsyncProxySlave, AsyncProxyMaster, ScriptsToImportPool);');
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxySlave'] = AsyncProxySlave;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['ScriptsToImportPool'] = ScriptsToImportPool;");
    
    return ExportAsyncProxySymbols;
}

(ExportAsyncProxySymbolsClosure())(SubWorkerEmulationForChrome, AsyncProxySlave, AsyncProxyMaster, ScriptsToImportPool);
self['AsyncProxy']['AsyncProxySlave'] = AsyncProxySlave;
self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;
self['AsyncProxy']['ScriptsToImportPool'] = ScriptsToImportPool;

'use strict';

function ExportAsyncProxySymbolsClosure() {
    function ExportAsyncProxySymbols(
            SubWorkerEmulationForChrome,
			AsyncProxyFactory,
            AsyncProxySlaveSingleton,
            AsyncProxyMaster,
            ScriptsToImportPool,
            DependencyWorkers,
            DependencyWorkersTaskHandle,
			DependencyWorkersTask,
            WrapperInputRetreiverBase,
            SchedulerTask,
            SchedulerWrapperInputRetreiver,
            SchedulerDependencyWorkers) {
                
        self['AsyncProxy'] = self['AsyncProxy'] || {};

        SubWorkerEmulationForChrome.prototype['postMessage'] = SubWorkerEmulationForChrome.prototype.postMessage;
        SubWorkerEmulationForChrome.prototype['terminate'] = SubWorkerEmulationForChrome.prototype.terminate;

        AsyncProxySlaveSingleton['setSlaveSideCreator'] = AsyncProxySlaveSingleton.setSlaveSideCreator;
        AsyncProxySlaveSingleton['setBeforeOperationListener'] = AsyncProxySlaveSingleton.setBeforeOperationListener;
        AsyncProxySlaveSingleton['sendUserDataToMaster'] = AsyncProxySlaveSingleton.sendUserDataToMaster;
        AsyncProxySlaveSingleton['wrapPromiseFromSlaveSide'] = AsyncProxySlaveSingleton.wrapPromiseFromSlaveSide;
        AsyncProxySlaveSingleton['wrapCallbackFromSlaveSide'] = AsyncProxySlaveSingleton.wrapCallbackFromSlaveSide;
		
		AsyncProxyFactory['create'] = AsyncProxyFactory.create;

        AsyncProxyMaster.prototype['setUserDataHandler'] = AsyncProxyMaster.prototype.setUserDataHandler;
        AsyncProxyMaster.prototype['terminate'] = AsyncProxyMaster.prototype.terminate;
        AsyncProxyMaster.prototype['callFunction'] = AsyncProxyMaster.prototype.callFunction;
        AsyncProxyMaster.prototype['wrapCallback'] = AsyncProxyMaster.prototype.wrapCallback;
        AsyncProxyMaster.prototype['freeCallback'] = AsyncProxyMaster.prototype.freeCallback;
        AsyncProxyMaster['getEntryUrl'] = AsyncProxyMaster.getEntryUrl;

        ScriptsToImportPool.prototype['addScriptFromErrorWithStackTrace'] = ScriptsToImportPool.prototype.addScriptFromErrorWithStackTrace;
        ScriptsToImportPool.prototype['getScriptsForWorkerImport'] = ScriptsToImportPool.prototype.getScriptsForWorkerImport;
        
        DependencyWorkers.prototype['startTask'] = DependencyWorkers.prototype.startTask;
        DependencyWorkers.prototype['startTaskPromise'] = DependencyWorkers.prototype.startTaskPromise;
        DependencyWorkers.prototype['getTaskContext'] = DependencyWorkers.prototype.getTaskContext;
        
        DependencyWorkersTaskHandle.prototype['hasData'] = DependencyWorkersTaskHandle.prototype.hasData;
        DependencyWorkersTaskHandle.prototype['getLastData'] = DependencyWorkersTaskHandle.prototype.getLastData;
        DependencyWorkersTaskHandle.prototype['setPriority'] = DependencyWorkersTaskHandle.prototype.setPriority;
        DependencyWorkersTaskHandle.prototype['unregister'] = DependencyWorkersTaskHandle.prototype.unregister;
		
		DependencyWorkersTask.prototype['dataReady'] = DependencyWorkersTask.prototype.dataReady;
		DependencyWorkersTask.prototype['terminate'] = DependencyWorkersTask.prototype.terminate;
		DependencyWorkersTask.prototype['registerTaskDependency'] = DependencyWorkersTask.prototype.registerTaskDependency;
		DependencyWorkersTask.prototype['on'] = DependencyWorkersTask.prototype.on;
        
        WrapperInputRetreiverBase.prototype['taskStarted'] = WrapperInputRetreiverBase.prototype.taskStarted;
        WrapperInputRetreiverBase.prototype['getWorkerTypeOptions'] = WrapperInputRetreiverBase.prototype.getWorkerTypeOptions;
        WrapperInputRetreiverBase.prototype['getKeyAsString'] = WrapperInputRetreiverBase.prototype.getKeyAsString;

        SchedulerWrapperInputRetreiver.prototype['taskStarted'] = SchedulerWrapperInputRetreiver.prototype.taskStarted;
    }
    
    asyncProxyScriptBlob.addMember(ExportAsyncProxySymbolsClosure, 'ExportAsyncProxySymbols');
    asyncProxyScriptBlob.addStatement('ExportAsyncProxySymbols(' +
        'SubWorkerEmulationForChrome, AsyncProxyFactory, AsyncProxySlaveSingleton, AsyncProxyMaster, ScriptsToImportPool, ' +
        'DependencyWorkers, DependencyWorkersTaskHandle, DependencyWorkersTask, WrapperInputRetreiverBase, ' +
        'SchedulerTask, SchedulerWrapperInputRetreiver, SchedulerDependencyWorkers);');
    
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxyFactory'] = AsyncProxyFactory;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxySlaveSingleton'] = AsyncProxySlaveSingleton;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['ScriptsToImportPool'] = ScriptsToImportPool;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['DependencyWorkers'] = DependencyWorkers;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['WrapperInputRetreiverBase'] = WrapperInputRetreiverBase;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['SchedulerTask'] = SchedulerTask;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['SchedulerWrapperInputRetreiver'] = SchedulerWrapperInputRetreiver;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['SchedulerDependencyWorkers'] = SchedulerDependencyWorkers;");
    
    return ExportAsyncProxySymbols;
}

(ExportAsyncProxySymbolsClosure())(
    SubWorkerEmulationForChrome, AsyncProxyFactory, AsyncProxySlaveSingleton, AsyncProxyMaster, ScriptsToImportPool,
    DependencyWorkers, DependencyWorkersTaskHandle, DependencyWorkersTask, WrapperInputRetreiverBase,
    SchedulerTask, SchedulerWrapperInputRetreiver, SchedulerDependencyWorkers);
self['AsyncProxy']['AsyncProxyFactory'] = AsyncProxyFactory;
self['AsyncProxy']['AsyncProxySlaveSingleton'] = AsyncProxySlaveSingleton;
self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;
self['AsyncProxy']['ScriptsToImportPool'] = ScriptsToImportPool;
self['AsyncProxy']['DependencyWorkers'] = DependencyWorkers;
self['AsyncProxy']['WrapperInputRetreiverBase'] = WrapperInputRetreiverBase;
self['AsyncProxy']['SchedulerTask'] = SchedulerTask;
self['AsyncProxy']['SchedulerWrapperInputRetreiver'] = SchedulerWrapperInputRetreiver;
self['AsyncProxy']['SchedulerDependencyWorkers'] = SchedulerDependencyWorkers;
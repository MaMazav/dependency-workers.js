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
            WrapperInputRetreiverBase,
            PromiseTask,
            PromiseWrapperInputRetreiver,
            PromiseDependencyWorkers,
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
        
        WrapperInputRetreiverBase.prototype['getTaskTypeOptions'] = WrapperInputRetreiverBase.prototype.getTaskTypeOptions;
        WrapperInputRetreiverBase.prototype['getKeyAsString'] = WrapperInputRetreiverBase.prototype.getKeyAsString;

        PromiseTask.prototype['onDependencyTaskResult'] = PromiseTask.prototype.onDependencyTaskResult;
        PromiseTask.prototype['statusUpdated'] = PromiseTask.prototype.statusUpdated;
        PromiseTask.prototype['getTaskType'] = PromiseTask.prototype.getTaskType;
        
        PromiseWrapperInputRetreiver.prototype['createTaskContext'] = PromiseWrapperInputRetreiver.prototype.createTaskContext;
        
        SchedulerTask.prototype['onDependencyTaskResult'] = SchedulerTask.prototype.onDependencyTaskResult;
        SchedulerTask.prototype['statusUpdated'] = SchedulerTask.prototype.statusUpdated;
        SchedulerTask.prototype['getTaskType'] = SchedulerTask.prototype.getTaskType;
        
        SchedulerWrapperInputRetreiver.prototype['createTaskContext'] = SchedulerWrapperInputRetreiver.prototype.createTaskContext;

        SchedulerDependencyWorkers.prototype['getTaskContext'] = SchedulerDependencyWorkers.prototype.getTaskContext;
    }
    
    asyncProxyScriptBlob.addMember(ExportAsyncProxySymbolsClosure, 'ExportAsyncProxySymbols');
    asyncProxyScriptBlob.addStatement('ExportAsyncProxySymbols(' +
        'SubWorkerEmulationForChrome, AsyncProxyFactory, AsyncProxySlaveSingleton, AsyncProxyMaster, ScriptsToImportPool, ' +
        'DependencyWorkers, DependencyWorkersTaskHandle, WrapperInputRetreiverBase, PromiseTask, PromiseWrapperInputRetreiver, ' +
        'PromiseDependencyWorkers, SchedulerTask, SchedulerWrapperInputRetreiver, SchedulerDependencyWorkers);');
    
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxyFactory'] = AsyncProxyFactory;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxySlaveSingleton'] = AsyncProxySlaveSingleton;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['ScriptsToImportPool'] = ScriptsToImportPool;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['DependencyWorkers'] = DependencyWorkers;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['WrapperInputRetreiverBase'] = WrapperInputRetreiverBase;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['PromiseTask'] = PromiseTask;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['PromiseWrapperInputRetreiver'] = PromiseWrapperInputRetreiver;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['PromiseDependencyWorkers'] = PromiseDependencyWorkers;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['SchedulerTask'] = SchedulerTask;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['SchedulerWrapperInputRetreiver'] = SchedulerWrapperInputRetreiver;");
    asyncProxyScriptBlob.addStatement("self['AsyncProxy']['SchedulerDependencyWorkers'] = SchedulerDependencyWorkers;");
    
    return ExportAsyncProxySymbols;
}

(ExportAsyncProxySymbolsClosure())(
    SubWorkerEmulationForChrome, AsyncProxyFactory, AsyncProxySlaveSingleton, AsyncProxyMaster, ScriptsToImportPool,
    DependencyWorkers, DependencyWorkersTaskHandle, WrapperInputRetreiverBase, PromiseTask, PromiseWrapperInputRetreiver,
    PromiseDependencyWorkers, SchedulerTask, SchedulerWrapperInputRetreiver, SchedulerDependencyWorkers);
self['AsyncProxy']['AsyncProxyFactory'] = AsyncProxyFactory;
self['AsyncProxy']['AsyncProxySlaveSingleton'] = AsyncProxySlaveSingleton;
self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;
self['AsyncProxy']['ScriptsToImportPool'] = ScriptsToImportPool;
self['AsyncProxy']['DependencyWorkers'] = DependencyWorkers;
self['AsyncProxy']['WrapperInputRetreiverBase'] = WrapperInputRetreiverBase;
self['AsyncProxy']['PromiseTask'] = PromiseTask;
self['AsyncProxy']['PromiseWrapperInputRetreiver'] = PromiseWrapperInputRetreiver;
self['AsyncProxy']['PromiseDependencyWorkers'] = PromiseDependencyWorkers;
self['AsyncProxy']['SchedulerTask'] = SchedulerTask;
self['AsyncProxy']['SchedulerWrapperInputRetreiver'] = SchedulerWrapperInputRetreiver;
self['AsyncProxy']['SchedulerDependencyWorkers'] = SchedulerDependencyWorkers;
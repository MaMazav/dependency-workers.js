'use strict';

function SchedulerWrapperInputRetreiverClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function SchedulerWrapperInputRetreiver(scheduler, inputRetreiver) {
        if (!inputRetreiver['createTaskContext']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.createTaskContext() method';
        }
        if (!inputRetreiver['getHashCode']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getHashCode() method';
        }
        if (!inputRetreiver['isEqual']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.isEqual() method';
        }

        var that = this;
        that._inputRetreiver = inputRetreiver;
        that._scheduler = scheduler;
    }
    
    SchedulerWrapperInputRetreiver.prototype.createTaskContext =
            function createTaskContext(taskKey, callbacks) {
        
        var wrapperTask = new SchedulerTask(scheduler, taskKey, callbacks);
        var wrappedTask = this._inputRetreiver.createTaskContext(
            taskKey, wrapperTask.getCallbacksForWrappedTask());
            
        wrapperTask.setWrappedContext(wrappedTask);
        return wrapperTask;
    };
    
    SchedulerWrapperInputRetreiver.prototype.getHashCode = function(key) {
        return this._inputRetreiver['getHashCode'](key);
    };
    
    SchedulerWrapperInputRetreiver.prototype.isEqual = function(key1, key2) {
        return this._inputRetreiver['isEqual'](key1, key2);
    };
    
    asyncProxyScriptBlob.addMember(
        SchedulerWrapperInputRetreiverClosure, 'SchedulerWrapperInputRetreiver');
    
    return SchedulerWrapperInputRetreiver;
}

var SchedulerWrapperInputRetreiver = SchedulerWrapperInputRetreiverClosure();
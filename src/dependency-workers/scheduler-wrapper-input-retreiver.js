'use strict';

function SchedulerWrapperInputRetreiverClosure(WrapperInputRetreiverBase) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function SchedulerWrapperInputRetreiver(scheduler, inputRetreiver) {
        WrapperInputRetreiverBase.call(this, inputRetreiver);
        var that = this;
        that._scheduler = scheduler;

        if (!inputRetreiver['createTaskContext']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.createTaskContext() method';
        }
    }
    
    SchedulerWrapperInputRetreiver.prototype = Object.create(WrapperInputRetreiverBase.prototype);
    
    SchedulerWrapperInputRetreiver.prototype.createTaskContext =
            function createTaskContext(taskKey, callbacks) {
        
        var wrapperTask = new SchedulerTask(this._scheduler, taskKey, callbacks);
        var wrappedTask = this._inputRetreiver['createTaskContext'](
            taskKey, wrapperTask.getCallbacksForWrappedTask());
            
        wrapperTask.setWrappedContext(wrappedTask);
        return wrapperTask;
    };
    
    asyncProxyScriptBlob.addMember(
        SchedulerWrapperInputRetreiverClosure, 'SchedulerWrapperInputRetreiver', null, 'WrapperInputRetreiverBase');
    
    return SchedulerWrapperInputRetreiver;
}

var SchedulerWrapperInputRetreiver = SchedulerWrapperInputRetreiverClosure(WrapperInputRetreiverBase);
'use strict';

function SchedulerWrapperInputRetreiverClosure(WrapperInputRetreiverBase) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function SchedulerWrapperInputRetreiver(scheduler, inputRetreiver) {
        WrapperInputRetreiverBase.call(this, inputRetreiver);
        var that = this;
        that._scheduler = scheduler;

        if (!inputRetreiver['taskStarted']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.taskStarted() method';
        }
    }
    
    SchedulerWrapperInputRetreiver.prototype = Object.create(WrapperInputRetreiverBase.prototype);
    
    SchedulerWrapperInputRetreiver.prototype.taskStarted =
            function taskStarted(taskKey, task) {
        
        var wrapperTask = new SchedulerTask(this._scheduler, taskKey, callbacks);
        var wrappedTask = this._inputRetreiver['taskStarted'](
            taskKey, wrapperTask.getCallbacksForWrappedTask());
            
        wrapperTask.setWrappedContext(wrappedTask);
        return wrapperTask;
    };
    
    asyncProxyScriptBlob.addMember(
        SchedulerWrapperInputRetreiverClosure, 'SchedulerWrapperInputRetreiver', null, 'WrapperInputRetreiverBase');
    
    return SchedulerWrapperInputRetreiver;
}

var SchedulerWrapperInputRetreiver = SchedulerWrapperInputRetreiverClosure(WrapperInputRetreiverBase);
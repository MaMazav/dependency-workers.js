'use strict';

function SchedulerWrapperInputRetreiverClosure(WrapperInputRetreiverBase) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function SchedulerWrapperInputRetreiver(scheduler, inputRetreiver) {
        WrapperInputRetreiverBase.call(this, inputRetreiver);
        var that = this;
        that._scheduler = scheduler;
		that._inputRetreiver = inputRetreiver;
		that._isDisableWorkerCache = {};

        if (!inputRetreiver['taskStarted']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.taskStarted() method';
        }
    }
    
    SchedulerWrapperInputRetreiver.prototype = Object.create(WrapperInputRetreiverBase.prototype);
    
    SchedulerWrapperInputRetreiver.prototype.taskStarted =
            function taskStarted(taskKey, task) {
        
        var wrapperTask = new SchedulerTask(
			this._scheduler, this._inputRetreiver, this._isDisableWorkerCache, taskKey, task);
        return this._inputRetreiver['taskStarted'](taskKey, wrapperTask);
    };
    
    asyncProxyScriptBlob.addMember(
        SchedulerWrapperInputRetreiverClosure, 'SchedulerWrapperInputRetreiver', null, 'WrapperInputRetreiverBase');
    
    return SchedulerWrapperInputRetreiver;
}

var SchedulerWrapperInputRetreiver = SchedulerWrapperInputRetreiverClosure(WrapperInputRetreiverBase);
'use strict';

function WrapperInputRetreiverBaseClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function WrapperInputRetreiverBase(inputRetreiver) {
        if (!inputRetreiver['getKeyAsString']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getKeyAsString() method';
        }
        if (!inputRetreiver['getWorkerTypeOptions']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getTaskTypeOptions() method';
        }

        var that = this;
        that._inputRetreiver = inputRetreiver;
    }
    
    WrapperInputRetreiverBase.prototype.taskStarted =
            function taskStarted(task) {
        
        throw 'AsyncProxy.WrapperInputRetreiverBase internal error: Not implemented taskStarted()';
    };
    
    WrapperInputRetreiverBase.prototype.getKeyAsString = function(key) {
        return this._inputRetreiver['getKeyAsString'](key);
    };
    
    
    WrapperInputRetreiverBase.prototype.getWorkerTypeOptions = function(taskType) {
        return this._inputRetreiver['getWorkerTypeOptions'](taskType);
    };
    
    asyncProxyScriptBlob.addMember(
        WrapperInputRetreiverBaseClosure, 'WrapperInputRetreiverBase');
    
    return WrapperInputRetreiverBase;
}

var WrapperInputRetreiverBase = WrapperInputRetreiverBaseClosure();
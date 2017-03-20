'use strict';

function WrapperInputRetreiverBaseClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function WrapperInputRetreiverBase(inputRetreiver) {
        if (!inputRetreiver['getKeyAsString']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getKeyAsString() method';
        }
        if (!inputRetreiver['getTaskTypeOptions']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getTaskTypeOptions() method';
        }

        var that = this;
        that._inputRetreiver = inputRetreiver;
    }
    
    WrapperInputRetreiverBase.prototype.createTaskContext =
            function createTaskContext(taskKey, callbacks) {
        
        throw 'AsyncProxy.WrapperInputRetreiverBase internal error: Not implemented createTaskContext()';
    };
    
    WrapperInputRetreiverBase.prototype.getKeyAsString = function(key) {
        return this._inputRetreiver['getKeyAsString'](key);
    };
    
    
    WrapperInputRetreiverBase.prototype.getTaskTypeOptions = function(taskType) {
        return this._inputRetreiver['getTaskTypeOptions'](taskType);
    };
    
    asyncProxyScriptBlob.addMember(
        WrapperInputRetreiverBaseClosure, 'WrapperInputRetreiverBase');
    
    return WrapperInputRetreiverBase;
}

var WrapperInputRetreiverBase = WrapperInputRetreiverBaseClosure();
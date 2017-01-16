'use strict';

function AsyncProxyFactoryClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    var factorySingleton = {};
	
	factorySingleton.create = function create(scriptsToImport, ctorName, methods, proxyCtor) {
		if (!scriptsToImport || !(scriptsToImport.length > 0)) {
			throw 'AsyncProxyFactory error: missing scriptsToImport (2nd argument)';
		}
		if (!methods) {
			throw 'AsyncProxyFactory error: missing methods (3rd argument)';
		}
		
		var ProxyClass = proxyCtor || function() {
			var that = this;
			this.__workerHelperCtorArgs = convertArgs(arguments);
		};
		
		ProxyClass.prototype['_getWorkerHelper'] = function getWorkerHelper() {
			if (!this.__workerHelper) {
				this.__workerHelper = new self['AsyncProxy']['AsyncProxyMaster'](
					scriptsToImport, ctorName, this.__workerHelperCtorArgs || []);
			}
			
			return this.__workerHelper;
		};
		
		for (var methodName in methods) {
			generateMethod(ProxyClass, methodName, methods[methodName] || []);
		}
		
		return ProxyClass;
	};
	
	function generateMethod(ProxyClass, methodName, methodArgsDescription) {
		if (typeof methodArgsDescription === 'function') {
			ProxyClass.prototype[methodName] = methodArgsDescription;
			return;
		}
		
		var methodOptions = methodArgsDescription[0] || {};
		ProxyClass.prototype[methodName] = function generatedFunction() {
			var workerHelper = this['_getWorkerHelper']();
			var argsToSend = [];
			for (var i = 0; i < arguments.length; ++i) {
				var argDescription = methodArgsDescription[i + 1];
				var argValue = arguments[i];
				
				if (argDescription === 'callback') {
					argsToSend[i] = workerHelper.wrapCallback(argValue);
				} else if (!argDescription) {
					argsToSend[i] = argValue;
				} else {
					throw 'AsyncProxyFactory error: Unrecognized argument ' +
						'description ' + argDescription + ' in argument ' +
						(i + 1) + ' of method ' + methodName;
				}
			}
			return workerHelper.callFunction(
				methodName, argsToSend, methodArgsDescription[0]);
		}
	};
	
	function convertArgs(argsObject) {
		var args = new Array(argsObject.length);
		for (var i = 0; i < argsObject.length; ++i) {
			args[i] = argsObject[i];
		}
		
		return args;
	}

	asyncProxyScriptBlob.addMember(AsyncProxyFactoryClosure, 'AsyncProxyFactory');
    
    return factorySingleton;
}

var AsyncProxyFactory = AsyncProxyFactoryClosure();
(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.resourceScheduler = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var LifoScheduler = (function LifoSchedulerClosure() {
    function LifoScheduler(createResource, jobsLimit) {
        this._resourceCreator = createResource;
        this._jobsLimit = jobsLimit;
        this._freeResourcesCount = this._jobsLimit;
        this._freeResources = new Array(this._jobsLimit);
        this._pendingJobs = [];
    }
    
    LifoScheduler.prototype.enqueueJob = function enqueueJob(jobFunc, jobContext) {
        if (this._freeResourcesCount > 0) {
            --this._freeResourcesCount;
            
            var resource = this._freeResources.pop();
            if (resource === undefined) {
                resource = this._resourceCreator();
            }
            
            this._schedule(jobFunc, resource, jobContext);
        } else {
            this._pendingJobs.push({
                jobFunc: jobFunc,
                jobContext: jobContext
                });
        }
    };
    
    LifoScheduler.prototype._schedule = function schedule(jobFunc, resource, jobContext) {
        var callbacks = new LifoSchedulerCallbacks(this, resource);
        jobFunc(resource, jobContext, callbacks);
    };
    
    function LifoSchedulerCallbacks(scheduler, resource) {
        this._scheduler = scheduler;
        this._resource = resource;
    }
    
    LifoSchedulerCallbacks.prototype.jobDone = function jobDone() {
        if (this._scheduler._pendingJobs.length > 0) {
            var nextJob = this._scheduler._pendingJobs.pop();
            this._scheduler._schedule(nextJob.jobFunc, this._resource, nextJob.jobContext);
        } else {
            this._scheduler._freeResources.push(this._resource);
            ++this._scheduler._freeResourcesCount;
        }
    };
    
    LifoSchedulerCallbacks.prototype.shouldYieldOrAbort = function shouldYieldOrAbort() {
        return false;
    };
    
    LifoSchedulerCallbacks.prototype.tryYield = function tryYield() {
        return false;
    };
    
    return LifoScheduler;
})();

module.exports = LifoScheduler;
},{}],2:[function(require,module,exports){
'use strict';

var LinkedList = (function LinkedListClosure() {
    function LinkedList() {
        this.clear();
    }
    
    LinkedList.prototype.clear = function clear() {
        this._first = { _prev: null, _parent: this };
        this._last = { _next: null, _parent: this };
        this._count = 0;
        
        this._last._prev = this._first;
        this._first._next = this._last;
    };
    
    LinkedList.prototype.add = function add(value, addBefore) {
        if (addBefore === null || addBefore === undefined) {
            addBefore = this._last;
        }
        
        this._validateIteratorOfThis(addBefore);
        
        ++this._count;
        
        var newNode = {
            _value: value,
            _next: addBefore,
            _prev: addBefore._prev,
            _parent: this
        };
        
        newNode._prev._next = newNode;
        addBefore._prev = newNode;
        
        return newNode;
    };
    
    LinkedList.prototype.remove = function remove(iterator) {
        this._validateIteratorOfThis(iterator);
        
        --this._count;
        
        iterator._prev._next = iterator._next;
        iterator._next._prev = iterator._prev;
        iterator._parent = null;
    };
    
    LinkedList.prototype.getFromIterator = function getFromIterator(iterator) {
        this._validateIteratorOfThis(iterator);
        
        return iterator._value;
    };
    
    LinkedList.prototype.getFirstIterator = function getFirstIterator() {
        var iterator = this.getNextIterator(this._first);
        return iterator;
    };
    
    LinkedList.prototype.getLastIterator = function getFirstIterator() {
        var iterator = this.getPrevIterator(this._last);
        return iterator;
    };
    
    LinkedList.prototype.getNextIterator = function getNextIterator(iterator) {
        this._validateIteratorOfThis(iterator);

        if (iterator._next === this._last) {
            return null;
        }
        
        return iterator._next;
    };
    
    LinkedList.prototype.getPrevIterator = function getPrevIterator(iterator) {
        this._validateIteratorOfThis(iterator);

        if (iterator._prev === this._first) {
            return null;
        }
        
        return iterator._prev;
    };
    
    LinkedList.prototype.getCount = function getCount() {
        return this._count;
    };
    
    LinkedList.prototype._validateIteratorOfThis =
        function validateIteratorOfThis(iterator) {
        
        if (iterator._parent !== this) {
            throw 'iterator must be of the current LinkedList';
        }
    };
    
    return LinkedList;
})();

module.exports = LinkedList;
},{}],3:[function(require,module,exports){
'use strict';

var LinkedList = require('linked-list');

var PriorityScheduler = (function PrioritySchedulerClosure() {
    function PriorityScheduler(
        createResource, jobsLimit, prioritizer, options) {
        
        options = options || {};
        this._resourceCreator = createResource;
        this._jobsLimit = jobsLimit;
        this._prioritizer = prioritizer;
        
        this._showLog = options.showLog;
        this._schedulerName = options.schedulerName;
        this._numNewJobs = options.numNewJobs || 20;
        this._numJobsBeforeRerankOldPriorities =
            options.numJobsBeforeRerankOldPriorities || 20;
            
        this._freeResourcesCount = this._jobsLimit;
        this._freeResources = new Array(this._jobsLimit);
        
        this._resourcesGuaranteedForHighPriority =
            options.resourcesGuaranteedForHighPriority || 0;
        this._highPriorityToGuaranteeResource =
            options.highPriorityToGuaranteeResource || 0;
        
        this._logCallIndentPrefix = '>';
        this._pendingJobsCount = 0;
        this._oldPendingJobsByPriority = [];
        this._newPendingJobsLinkedList = new LinkedList();
        
        this._schedulesCounter = 0;
    }
    
    PriorityScheduler.prototype.enqueueJob = function enqueueJob(jobFunc, jobContext, jobAbortedFunc) {
        log(this, 'enqueueJob() start', +1);
        var priority = this._prioritizer.getPriority(jobContext);
        
        if (priority < 0) {
            jobAbortedFunc(jobContext);
            log(this, 'enqueueJob() end: job aborted', -1);
            return;
        }
        
        var job = {
            jobFunc: jobFunc,
            jobAbortedFunc: jobAbortedFunc,
            jobContext: jobContext
        };
        
        var minPriority = getMinimalPriorityToSchedule(this);
        
        var resource = null;
        if (priority >= minPriority) {
            resource = tryGetFreeResource(this);
        }
        
        if (resource !== null) {
            schedule(this, job, resource);
            log(this, 'enqueueJob() end: job scheduled', -1);
            return;
        }
        
        enqueueNewJob(this, job, priority);
        ensurePendingJobsCount(this);
        log(this, 'enqueueJob() end: job pending', -1);
    };

    function jobDoneInternal(self, resource, jobContext) {
        if (self._showLog) {
            var priority = self._prioritizer.getPriority(jobContext);
            log(self, 'jobDone() start: job done of priority ' + priority, +1);
        }
        
        resourceFreed(self, resource);
        ensurePendingJobsCount(self);
        log(self, 'jobDone() end', -1);
    }
    
    function shouldYieldOrAbortInternal(self, jobContext) {
        log(self, 'shouldYieldOrAbort() start', +1);
        var priority = self._prioritizer.getPriority(jobContext);
        var result = (priority < 0) || hasNewJobWithHigherPriority(self, priority);
        log(self, 'shouldYieldOrAbort() end', -1);
        return result;
    }
    
    function tryYieldInternal(
        self, jobContinueFunc, jobContext, jobAbortedFunc, jobYieldedFunc, resource) {
        
        log(self, 'tryYield() start', +1);
        var priority = self._prioritizer.getPriority(jobContext);
        if (priority < 0) {
            jobAbortedFunc(jobContext);
            resourceFreed(self, resource);
            log(self, 'tryYield() end: job aborted', -1);
            return true;
        }
            
        var higherPriorityJob = tryDequeueNewJobWithHigherPriority(
            self, priority);
        ensurePendingJobsCount(self);
        
        if (higherPriorityJob === null) {
            log(self, 'tryYield() end: job continues', -1);
            return false;
        }
        
        jobYieldedFunc(jobContext);

        var job = {
            jobFunc: jobContinueFunc,
            jobAbortedFunc: jobAbortedFunc,
            jobContext: jobContext
            };
            
        enqueueNewJob(self, job, priority);
        ensurePendingJobsCount(self);

        schedule(self, higherPriorityJob, resource);
        ensurePendingJobsCount(self);
        
        log(self, 'tryYield() end: job yielded', -1);
        return true;
    }
    
    function hasNewJobWithHigherPriority(self, lowPriority) {
        var currentNode = self._newPendingJobsLinkedList.getFirstIterator();
        
        log(self, 'hasNewJobWithHigherPriority() start', +1);
        
        while (currentNode !== null) {
            var nextNode = self._newPendingJobsLinkedList.getNextIterator(
                currentNode);
                
            var job = self._newPendingJobsLinkedList.getFromIterator(currentNode);
            var priority = self._prioritizer.getPriority(job.jobContext);
            
            if (priority < 0) {
                extractJobFromLinkedList(self, currentNode);
                --self._pendingJobsCount;
                
                job.jobAbortedFunc(job.jobContext);
                currentNode = nextNode;
                continue;
            }
            
            if (priority > lowPriority) {
                log(self, 'hasNewJobWithHigherPriority() end: returns true', -1);
                return true;
            }
            
            currentNode = nextNode;
        }
        
        log(self, 'hasNewJobWithHigherPriority() end: returns false', -1);
        return false;
    }
    
    function tryDequeueNewJobWithHigherPriority(self, lowPriority) {
        log(self, 'tryDequeueNewJobWithHigherPriority() start', +1);
        var jobToScheduleNode = null;
        var highestPriorityFound = lowPriority;
        var countedPriorities = [];

        var currentNode = self._newPendingJobsLinkedList.getFirstIterator();
        
        while (currentNode !== null) {
            var nextNode = self._newPendingJobsLinkedList.getNextIterator(
                currentNode);
                
            var job = self._newPendingJobsLinkedList.getFromIterator(currentNode);
            var priority = self._prioritizer.getPriority(job.jobContext);
            
            if (priority < 0) {
                extractJobFromLinkedList(self, currentNode);
                --self._pendingJobsCount;
                
                job.jobAbortedFunc(job.jobContext);
                currentNode = nextNode;
                continue;
            }
            
            if (highestPriorityFound === undefined ||
                priority > highestPriorityFound) {
                
                highestPriorityFound = priority;
                jobToScheduleNode = currentNode;
            }
            
            if (!self._showLog) {
                currentNode = nextNode;
                continue;
            }
            
            if (countedPriorities[priority] === undefined) {
                countedPriorities[priority] = 1;
            } else {
                ++countedPriorities[priority];
            }
            
            currentNode = nextNode;
        }
        
        var jobToSchedule = null;
        if (jobToScheduleNode !== null) {
            jobToSchedule = extractJobFromLinkedList(self, jobToScheduleNode);
            --self._pendingJobsCount;
        }
        
        if (self._showLog) {
            var jobsListMessage = 'tryDequeueNewJobWithHigherPriority(): Jobs list:';

            for (var i = 0; i < countedPriorities.length; ++i) {
                if (countedPriorities[i] !== undefined) {
                    jobsListMessage += countedPriorities[i] + ' jobs of priority ' + i + ';';
                }
            }
            
            log(self, jobsListMessage);

            if (jobToSchedule !== null) {
                log(self, 'tryDequeueNewJobWithHigherPriority(): dequeued new job of priority ' + highestPriorityFound);
            }
        }
        
        ensurePendingJobsCount(self);
        
        log(self, 'tryDequeueNewJobWithHigherPriority() end', -1);
        return jobToSchedule;
    }
    
    function tryGetFreeResource(self) {
        log(self, 'tryGetFreeResource() start', +1);
        if (self._freeResourcesCount === 0) {
            return null;
        }
        --self._freeResourcesCount;
        var resource = self._freeResources.pop();
        
        if (resource === undefined) {
            resource = self._resourceCreator();
        }
        
        ensurePendingJobsCount(self);
        
        log(self, 'tryGetFreeResource() end', -1);
        return resource;
    }
    
    function enqueueNewJob(self, job, priority) {
        log(self, 'enqueueNewJob() start', +1);
        ++self._pendingJobsCount;
        
        var firstIterator = self._newPendingJobsLinkedList.getFirstIterator();
        addJobToLinkedList(self, job, firstIterator);
        
        if (self._showLog) {
            log(self, 'enqueueNewJob(): enqueued job of priority ' + priority);
        }
        
        if (self._newPendingJobsLinkedList.getCount() <= self._numNewJobs) {
            ensurePendingJobsCount(self);
            log(self, 'enqueueNewJob() end: _newPendingJobsLinkedList is small enough', -1);
            return;
        }
        
        var lastIterator = self._newPendingJobsLinkedList.getLastIterator();
        var oldJob = extractJobFromLinkedList(self, lastIterator);
        enqueueOldJob(self, oldJob);
        ensurePendingJobsCount(self);
        log(self, 'enqueueNewJob() end: One job moved from new job list to old job list', -1);
    }
    
    function enqueueOldJob(self, job) {
        log(self, 'enqueueOldJob() start', +1);
        var priority = self._prioritizer.getPriority(job.jobContext);
        
        if (priority < 0) {
            --self._pendingJobsCount;
            job.jobAbortedFunc(job.jobContext);
            log(self, 'enqueueOldJob() end: job aborted', -1);
            return;
        }
        
        if (self._oldPendingJobsByPriority[priority] === undefined) {
            self._oldPendingJobsByPriority[priority] = [];
        }
        
        self._oldPendingJobsByPriority[priority].push(job);
        log(self, 'enqueueOldJob() end: job enqueued to old job list', -1);
    }
    
    function rerankPriorities(self) {
        log(self, 'rerankPriorities() start', +1);
        var originalOldsArray = self._oldPendingJobsByPriority;
        var originalNewsList = self._newPendingJobsLinkedList;
        
        if (originalOldsArray.length === 0) {
            log(self, 'rerankPriorities() end: no need to rerank', -1);
            return;
        }
        
        self._oldPendingJobsByPriority = [];
        self._newPendingJobsLinkedList = new LinkedList();
        
        for (var i = 0; i < originalOldsArray.length; ++i) {
            if (originalOldsArray[i] === undefined) {
                continue;
            }
            
            for (var j = 0; j < originalOldsArray[i].length; ++j) {
                enqueueOldJob(self, originalOldsArray[i][j]);
            }
        }
        
        var iterator = originalNewsList.getFirstIterator();
        while (iterator !== null) {
            var value = originalNewsList.getFromIterator(iterator);
            enqueueOldJob(self, value);
            
            iterator = originalNewsList.getNextIterator(iterator);
        }
        
        var message = 'rerankPriorities(): ';
        
        for (var k = self._oldPendingJobsByPriority.length - 1; k >= 0; --k) {
            var highPriorityJobs = self._oldPendingJobsByPriority[k];
            if (highPriorityJobs === undefined) {
                continue;
            }
            
            if (self._showLog) {
                message += highPriorityJobs.length + ' jobs in priority ' + k + ';';
            }
            
            while (highPriorityJobs.length > 0 &&
                    self._newPendingJobsLinkedList.getCount() < self._numNewJobs) {
                    
                var job = highPriorityJobs.pop();
                addJobToLinkedList(self, job);
            }
            
            if (self._newPendingJobsLinkedList.getCount() >= self._numNewJobs &&
                !self._showLog) {
                break;
            }
        }
        
        if (self._showLog) {
            log(self, message);
        }
        
        ensurePendingJobsCount(self);
        log(self, 'rerankPriorities() end: rerank done', -1);
    }
    
    function resourceFreed(self, resource) {
        log(self, 'resourceFreed() start', +1);
        ++self._freeResourcesCount;
        var minPriority = getMinimalPriorityToSchedule(self);
        --self._freeResourcesCount;
        
        var job = tryDequeueNewJobWithHigherPriority(self, minPriority);

        if (job !== null) {
            ensurePendingJobsCount(self);
            schedule(self, job, resource);
            ensurePendingJobsCount(self);
            
            log(self, 'resourceFreed() end: new job scheduled', -1);
            return;
        }
        
        var hasOldJobs =
            self._pendingJobsCount > self._newPendingJobsLinkedList.getCount();
            
        if (!hasOldJobs) {
            self._freeResources.push(resource);
            ++self._freeResourcesCount;
            
            ensurePendingJobsCount(self);
            log(self, 'resourceFreed() end: no job to schedule', -1);
            return;
        }
        
        var numPriorities = self._oldPendingJobsByPriority.length;
        var jobPriority;
        
        for (var priority = numPriorities - 1; priority >= 0; --priority) {
            var jobs = self._oldPendingJobsByPriority[priority];
            if (jobs === undefined || jobs.length === 0) {
                continue;
            }
            
            for (var i = jobs.length - 1; i >= 0; --i) {
                job = jobs[i];
                jobPriority = self._prioritizer.getPriority(job.jobContext);
                if (jobPriority >= priority) {
                    jobs.length = i;
                    break;
                } else if (jobPriority < 0) {
                    --self._pendingJobsCount;
                    job.jobAbortedFunc(job.jobContext);
                } else {
                    if (self._oldPendingJobsByPriority[jobPriority] === undefined) {
                        self._oldPendingJobsByPriority[jobPriority] = [];
                    }
                    
                    self._oldPendingJobsByPriority[jobPriority].push(job);
                }
                
                job = null;
            }
            
            if (job !== null) {
                break;
            }
            
            jobs.length = 0;
        }
        
        if (job === null) {
            self._freeResources.push(resource);
            ++self._freeResourcesCount;
            
            ensurePendingJobsCount(self);
            
            log(self, 'resourceFreed() end: no non-aborted job to schedule', -1);
            return;
        }
        
        if (self._showLog) {
            log(self, 'resourceFreed(): dequeued old job of priority ' + jobPriority);
        }
        
        --self._pendingJobsCount;
        
        ensurePendingJobsCount(self);
        schedule(self, job, resource);
        ensurePendingJobsCount(self);
        log(self, 'resourceFreed() end: job scheduled', -1);
    }
    
    function schedule(self, job, resource) {
        log(self, 'schedule() start', +1);
        ++self._schedulesCounter;
        
        if (self._schedulesCounter >= self._numJobsBeforeRerankOldPriorities) {
            self._schedulesCounter = 0;
            rerankPriorities(self);
        }
        
        if (self._showLog) {
            var priority = self._prioritizer.getPriority(job.jobContext);
            log(self, 'schedule(): scheduled job of priority ' + priority);
        }
        
        var callbacks = new PrioritySchedulerCallbacks(self, resource, job.jobContext);
        
        job.jobFunc(resource, job.jobContext, callbacks);
        log(self, 'schedule() end', -1);
    }
    
    function addJobToLinkedList(self, job, addBefore) {
        log(self, 'addJobToLinkedList() start', +1);
        self._newPendingJobsLinkedList.add(job, addBefore);
        ensureNumberOfNodes(self);
        log(self, 'addJobToLinkedList() end', -1);
    }
    
    function extractJobFromLinkedList(self, iterator) {
        log(self, 'extractJobFromLinkedList() start', +1);
        var value = self._newPendingJobsLinkedList.getFromIterator(iterator);
        self._newPendingJobsLinkedList.remove(iterator);
        ensureNumberOfNodes(self);
        
        log(self, 'extractJobFromLinkedList() end', -1);
        return value;
    }
    
    function ensureNumberOfNodes(self) {
        if (!self._showLog) {
            return;
        }
        
        log(self, 'ensureNumberOfNodes() start', +1);
        var iterator = self._newPendingJobsLinkedList.getFirstIterator();
        var expectedCount = 0;
        while (iterator !== null) {
            ++expectedCount;
            iterator = self._newPendingJobsLinkedList.getNextIterator(iterator);
        }
        
        if (expectedCount !== self._newPendingJobsLinkedList.getCount()) {
            throw 'Unexpected count of new jobs';
        }
        log(self, 'ensureNumberOfNodes() end', -1);
    }
    
    function ensurePendingJobsCount(self) {
        if (!self._showLog) {
            return;
        }
        
        log(self, 'ensurePendingJobsCount() start', +1);
        var oldJobsCount = 0;
        for (var i = 0; i < self._oldPendingJobsByPriority.length; ++i) {
            var jobs = self._oldPendingJobsByPriority[i];
            if (jobs !== undefined) {
                oldJobsCount += jobs.length;
            }
        }
        
        var expectedCount =
            oldJobsCount + self._newPendingJobsLinkedList.getCount();
            
        if (expectedCount !== self._pendingJobsCount) {
            throw 'Unexpected count of jobs';
        }
        log(self, 'ensurePendingJobsCount() end', -1);
    }
    
    function getMinimalPriorityToSchedule(self) {
        log(self, 'getMinimalPriorityToSchedule() start', +1);
        if (self._freeResourcesCount <= self._resourcesGuaranteedForHighPriority) {
            log(self, 'getMinimalPriorityToSchedule() end: guarantee resource for high priority is needed', -1);
            return self._highPriorityToGuaranteeResources;
        }
        
        log(self, 'getMinimalPriorityToSchedule() end: enough resources, no need to guarantee resource for high priority', -1);
        return 0;
    }
    
    function log(self, msg, addIndent) {
        if (!self._showLog) {
            return;
        }
        
        if (addIndent === -1) {
            self._logCallIndentPrefix = self._logCallIndentPrefix.substr(1);
        }
        
        if (self._schedulerName !== undefined) {
            /* global console: false */
            console.log(self._logCallIndentPrefix + 'PriorityScheduler ' + self._schedulerName + ': ' + msg);
        } else {
            /* global console: false */
            console.log(self._logCallIndentPrefix + 'PriorityScheduler: ' + msg);
        }
    
        if (addIndent === 1) {
            self._logCallIndentPrefix += '>';
        }
    }
    
    function PrioritySchedulerCallbacks(scheduler, resource, context) {
        this._isValid = true;
        this._scheduler = scheduler;
        this._resource = resource;
        this._context = context;
    }
    
    PrioritySchedulerCallbacks.prototype._checkValidity = function checkValidity() {
        if (!this._isValid) {
            throw 'ResourceScheduler error: Already terminated job';
        }
    };
    
    PrioritySchedulerCallbacks.prototype._clearValidity = function() {
        this._isValid = false;
        this._resource = null;
        this._context = null;
        this._scheduler = null;
    };
    
    PrioritySchedulerCallbacks.prototype.jobDone = function jobDone() {
        this._checkValidity();
        jobDoneInternal(this._scheduler, this._resource, this._context);
        this._clearValidity();
    };
    
    PrioritySchedulerCallbacks.prototype.shouldYieldOrAbort = function() {
        this._checkValidity();
        return shouldYieldOrAbortInternal(this._scheduler, this._context);
    };
    
    PrioritySchedulerCallbacks.prototype.tryYield = function tryYield(jobContinueFunc, jobAbortedFunc, jobYieldedFunc) {
        this._checkValidity();
        var isYielded = tryYieldInternal(
            this._scheduler, jobContinueFunc, this._context, jobAbortedFunc, jobYieldedFunc, this._resource);
        if (isYielded) {
            this._clearValidity();
        }
        return isYielded;
    };

    return PriorityScheduler;
})();

module.exports = PriorityScheduler;
},{"linked-list":2}],4:[function(require,module,exports){
'use strict';

module.exports.PriorityScheduler = require('priority-scheduler');
module.exports.LifoScheduler = require('lifo-scheduler');

},{"lifo-scheduler":1,"priority-scheduler":3}]},{},[4])(4)
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvbGlmby1zY2hlZHVsZXIuanMiLCJzcmMvbGlua2VkLWxpc3QuanMiLCJzcmMvcHJpb3JpdHktc2NoZWR1bGVyLmpzIiwic3JjL3Jlc291cmNlLXNjaGVkdWxlci1leHBvcnRzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25HQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3psQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlmb1NjaGVkdWxlciA9IChmdW5jdGlvbiBMaWZvU2NoZWR1bGVyQ2xvc3VyZSgpIHtcclxuICAgIGZ1bmN0aW9uIExpZm9TY2hlZHVsZXIoY3JlYXRlUmVzb3VyY2UsIGpvYnNMaW1pdCkge1xyXG4gICAgICAgIHRoaXMuX3Jlc291cmNlQ3JlYXRvciA9IGNyZWF0ZVJlc291cmNlO1xyXG4gICAgICAgIHRoaXMuX2pvYnNMaW1pdCA9IGpvYnNMaW1pdDtcclxuICAgICAgICB0aGlzLl9mcmVlUmVzb3VyY2VzQ291bnQgPSB0aGlzLl9qb2JzTGltaXQ7XHJcbiAgICAgICAgdGhpcy5fZnJlZVJlc291cmNlcyA9IG5ldyBBcnJheSh0aGlzLl9qb2JzTGltaXQpO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdKb2JzID0gW107XHJcbiAgICB9XHJcbiAgICBcclxuICAgIExpZm9TY2hlZHVsZXIucHJvdG90eXBlLmVucXVldWVKb2IgPSBmdW5jdGlvbiBlbnF1ZXVlSm9iKGpvYkZ1bmMsIGpvYkNvbnRleHQpIHtcclxuICAgICAgICBpZiAodGhpcy5fZnJlZVJlc291cmNlc0NvdW50ID4gMCkge1xyXG4gICAgICAgICAgICAtLXRoaXMuX2ZyZWVSZXNvdXJjZXNDb3VudDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHZhciByZXNvdXJjZSA9IHRoaXMuX2ZyZWVSZXNvdXJjZXMucG9wKCk7XHJcbiAgICAgICAgICAgIGlmIChyZXNvdXJjZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICByZXNvdXJjZSA9IHRoaXMuX3Jlc291cmNlQ3JlYXRvcigpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLl9zY2hlZHVsZShqb2JGdW5jLCByZXNvdXJjZSwgam9iQ29udGV4dCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5fcGVuZGluZ0pvYnMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICBqb2JGdW5jOiBqb2JGdW5jLFxyXG4gICAgICAgICAgICAgICAgam9iQ29udGV4dDogam9iQ29udGV4dFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlmb1NjaGVkdWxlci5wcm90b3R5cGUuX3NjaGVkdWxlID0gZnVuY3Rpb24gc2NoZWR1bGUoam9iRnVuYywgcmVzb3VyY2UsIGpvYkNvbnRleHQpIHtcclxuICAgICAgICB2YXIgY2FsbGJhY2tzID0gbmV3IExpZm9TY2hlZHVsZXJDYWxsYmFja3ModGhpcywgcmVzb3VyY2UpO1xyXG4gICAgICAgIGpvYkZ1bmMocmVzb3VyY2UsIGpvYkNvbnRleHQsIGNhbGxiYWNrcyk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBMaWZvU2NoZWR1bGVyQ2FsbGJhY2tzKHNjaGVkdWxlciwgcmVzb3VyY2UpIHtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2UgPSByZXNvdXJjZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgTGlmb1NjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuam9iRG9uZSA9IGZ1bmN0aW9uIGpvYkRvbmUoKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX3NjaGVkdWxlci5fcGVuZGluZ0pvYnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICB2YXIgbmV4dEpvYiA9IHRoaXMuX3NjaGVkdWxlci5fcGVuZGluZ0pvYnMucG9wKCk7XHJcbiAgICAgICAgICAgIHRoaXMuX3NjaGVkdWxlci5fc2NoZWR1bGUobmV4dEpvYi5qb2JGdW5jLCB0aGlzLl9yZXNvdXJjZSwgbmV4dEpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLl9zY2hlZHVsZXIuX2ZyZWVSZXNvdXJjZXMucHVzaCh0aGlzLl9yZXNvdXJjZSk7XHJcbiAgICAgICAgICAgICsrdGhpcy5fc2NoZWR1bGVyLl9mcmVlUmVzb3VyY2VzQ291bnQ7XHJcbiAgICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlmb1NjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuc2hvdWxkWWllbGRPckFib3J0ID0gZnVuY3Rpb24gc2hvdWxkWWllbGRPckFib3J0KCkge1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpZm9TY2hlZHVsZXJDYWxsYmFja3MucHJvdG90eXBlLnRyeVlpZWxkID0gZnVuY3Rpb24gdHJ5WWllbGQoKSB7XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIExpZm9TY2hlZHVsZXI7XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IExpZm9TY2hlZHVsZXI7IiwiJ3VzZSBzdHJpY3QnO1xyXG5cclxudmFyIExpbmtlZExpc3QgPSAoZnVuY3Rpb24gTGlua2VkTGlzdENsb3N1cmUoKSB7XHJcbiAgICBmdW5jdGlvbiBMaW5rZWRMaXN0KCkge1xyXG4gICAgICAgIHRoaXMuY2xlYXIoKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUuY2xlYXIgPSBmdW5jdGlvbiBjbGVhcigpIHtcclxuICAgICAgICB0aGlzLl9maXJzdCA9IHsgX3ByZXY6IG51bGwsIF9wYXJlbnQ6IHRoaXMgfTtcclxuICAgICAgICB0aGlzLl9sYXN0ID0geyBfbmV4dDogbnVsbCwgX3BhcmVudDogdGhpcyB9O1xyXG4gICAgICAgIHRoaXMuX2NvdW50ID0gMDtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9sYXN0Ll9wcmV2ID0gdGhpcy5fZmlyc3Q7XHJcbiAgICAgICAgdGhpcy5fZmlyc3QuX25leHQgPSB0aGlzLl9sYXN0O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUuYWRkID0gZnVuY3Rpb24gYWRkKHZhbHVlLCBhZGRCZWZvcmUpIHtcclxuICAgICAgICBpZiAoYWRkQmVmb3JlID09PSBudWxsIHx8IGFkZEJlZm9yZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgIGFkZEJlZm9yZSA9IHRoaXMuX2xhc3Q7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRoaXMuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoYWRkQmVmb3JlKTtcclxuICAgICAgICBcclxuICAgICAgICArK3RoaXMuX2NvdW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBuZXdOb2RlID0ge1xyXG4gICAgICAgICAgICBfdmFsdWU6IHZhbHVlLFxyXG4gICAgICAgICAgICBfbmV4dDogYWRkQmVmb3JlLFxyXG4gICAgICAgICAgICBfcHJldjogYWRkQmVmb3JlLl9wcmV2LFxyXG4gICAgICAgICAgICBfcGFyZW50OiB0aGlzXHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICBuZXdOb2RlLl9wcmV2Ll9uZXh0ID0gbmV3Tm9kZTtcclxuICAgICAgICBhZGRCZWZvcmUuX3ByZXYgPSBuZXdOb2RlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBuZXdOb2RlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUucmVtb3ZlID0gZnVuY3Rpb24gcmVtb3ZlKGl0ZXJhdG9yKSB7XHJcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLS10aGlzLl9jb3VudDtcclxuICAgICAgICBcclxuICAgICAgICBpdGVyYXRvci5fcHJldi5fbmV4dCA9IGl0ZXJhdG9yLl9uZXh0O1xyXG4gICAgICAgIGl0ZXJhdG9yLl9uZXh0Ll9wcmV2ID0gaXRlcmF0b3IuX3ByZXY7XHJcbiAgICAgICAgaXRlcmF0b3IuX3BhcmVudCA9IG51bGw7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBMaW5rZWRMaXN0LnByb3RvdHlwZS5nZXRGcm9tSXRlcmF0b3IgPSBmdW5jdGlvbiBnZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpIHtcclxuICAgICAgICB0aGlzLl92YWxpZGF0ZUl0ZXJhdG9yT2ZUaGlzKGl0ZXJhdG9yKTtcclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gaXRlcmF0b3IuX3ZhbHVlO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0Rmlyc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXROZXh0SXRlcmF0b3IodGhpcy5fZmlyc3QpO1xyXG4gICAgICAgIHJldHVybiBpdGVyYXRvcjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmdldExhc3RJdGVyYXRvciA9IGZ1bmN0aW9uIGdldEZpcnN0SXRlcmF0b3IoKSB7XHJcbiAgICAgICAgdmFyIGl0ZXJhdG9yID0gdGhpcy5nZXRQcmV2SXRlcmF0b3IodGhpcy5fbGFzdCk7XHJcbiAgICAgICAgcmV0dXJuIGl0ZXJhdG9yO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0TmV4dEl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0TmV4dEl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgICAgIGlmIChpdGVyYXRvci5fbmV4dCA9PT0gdGhpcy5fbGFzdCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGl0ZXJhdG9yLl9uZXh0O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUuZ2V0UHJldkl0ZXJhdG9yID0gZnVuY3Rpb24gZ2V0UHJldkl0ZXJhdG9yKGl0ZXJhdG9yKSB7XHJcbiAgICAgICAgdGhpcy5fdmFsaWRhdGVJdGVyYXRvck9mVGhpcyhpdGVyYXRvcik7XHJcblxyXG4gICAgICAgIGlmIChpdGVyYXRvci5fcHJldiA9PT0gdGhpcy5fZmlyc3QpIHtcclxuICAgICAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBpdGVyYXRvci5fcHJldjtcclxuICAgIH07XHJcbiAgICBcclxuICAgIExpbmtlZExpc3QucHJvdG90eXBlLmdldENvdW50ID0gZnVuY3Rpb24gZ2V0Q291bnQoKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvdW50O1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgTGlua2VkTGlzdC5wcm90b3R5cGUuX3ZhbGlkYXRlSXRlcmF0b3JPZlRoaXMgPVxyXG4gICAgICAgIGZ1bmN0aW9uIHZhbGlkYXRlSXRlcmF0b3JPZlRoaXMoaXRlcmF0b3IpIHtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaXRlcmF0b3IuX3BhcmVudCAhPT0gdGhpcykge1xyXG4gICAgICAgICAgICB0aHJvdyAnaXRlcmF0b3IgbXVzdCBiZSBvZiB0aGUgY3VycmVudCBMaW5rZWRMaXN0JztcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICByZXR1cm4gTGlua2VkTGlzdDtcclxufSkoKTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTGlua2VkTGlzdDsiLCIndXNlIHN0cmljdCc7XHJcblxyXG52YXIgTGlua2VkTGlzdCA9IHJlcXVpcmUoJ2xpbmtlZC1saXN0Jyk7XHJcblxyXG52YXIgUHJpb3JpdHlTY2hlZHVsZXIgPSAoZnVuY3Rpb24gUHJpb3JpdHlTY2hlZHVsZXJDbG9zdXJlKCkge1xyXG4gICAgZnVuY3Rpb24gUHJpb3JpdHlTY2hlZHVsZXIoXHJcbiAgICAgICAgY3JlYXRlUmVzb3VyY2UsIGpvYnNMaW1pdCwgcHJpb3JpdGl6ZXIsIG9wdGlvbnMpIHtcclxuICAgICAgICBcclxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcclxuICAgICAgICB0aGlzLl9yZXNvdXJjZUNyZWF0b3IgPSBjcmVhdGVSZXNvdXJjZTtcclxuICAgICAgICB0aGlzLl9qb2JzTGltaXQgPSBqb2JzTGltaXQ7XHJcbiAgICAgICAgdGhpcy5fcHJpb3JpdGl6ZXIgPSBwcmlvcml0aXplcjtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9zaG93TG9nID0gb3B0aW9ucy5zaG93TG9nO1xyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlck5hbWUgPSBvcHRpb25zLnNjaGVkdWxlck5hbWU7XHJcbiAgICAgICAgdGhpcy5fbnVtTmV3Sm9icyA9IG9wdGlvbnMubnVtTmV3Sm9icyB8fCAyMDtcclxuICAgICAgICB0aGlzLl9udW1Kb2JzQmVmb3JlUmVyYW5rT2xkUHJpb3JpdGllcyA9XHJcbiAgICAgICAgICAgIG9wdGlvbnMubnVtSm9ic0JlZm9yZVJlcmFua09sZFByaW9yaXRpZXMgfHwgMjA7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgIHRoaXMuX2ZyZWVSZXNvdXJjZXNDb3VudCA9IHRoaXMuX2pvYnNMaW1pdDtcclxuICAgICAgICB0aGlzLl9mcmVlUmVzb3VyY2VzID0gbmV3IEFycmF5KHRoaXMuX2pvYnNMaW1pdCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2VzR3VhcmFudGVlZEZvckhpZ2hQcmlvcml0eSA9XHJcbiAgICAgICAgICAgIG9wdGlvbnMucmVzb3VyY2VzR3VhcmFudGVlZEZvckhpZ2hQcmlvcml0eSB8fCAwO1xyXG4gICAgICAgIHRoaXMuX2hpZ2hQcmlvcml0eVRvR3VhcmFudGVlUmVzb3VyY2UgPVxyXG4gICAgICAgICAgICBvcHRpb25zLmhpZ2hQcmlvcml0eVRvR3VhcmFudGVlUmVzb3VyY2UgfHwgMDtcclxuICAgICAgICBcclxuICAgICAgICB0aGlzLl9sb2dDYWxsSW5kZW50UHJlZml4ID0gJz4nO1xyXG4gICAgICAgIHRoaXMuX3BlbmRpbmdKb2JzQ291bnQgPSAwO1xyXG4gICAgICAgIHRoaXMuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eSA9IFtdO1xyXG4gICAgICAgIHRoaXMuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdCA9IG5ldyBMaW5rZWRMaXN0KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdGhpcy5fc2NoZWR1bGVzQ291bnRlciA9IDA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIFByaW9yaXR5U2NoZWR1bGVyLnByb3RvdHlwZS5lbnF1ZXVlSm9iID0gZnVuY3Rpb24gZW5xdWV1ZUpvYihqb2JGdW5jLCBqb2JDb250ZXh0LCBqb2JBYm9ydGVkRnVuYykge1xyXG4gICAgICAgIGxvZyh0aGlzLCAnZW5xdWV1ZUpvYigpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBwcmlvcml0eSA9IHRoaXMuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYkNvbnRleHQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChwcmlvcml0eSA8IDApIHtcclxuICAgICAgICAgICAgam9iQWJvcnRlZEZ1bmMoam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgIGxvZyh0aGlzLCAnZW5xdWV1ZUpvYigpIGVuZDogam9iIGFib3J0ZWQnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGpvYiA9IHtcclxuICAgICAgICAgICAgam9iRnVuYzogam9iRnVuYyxcclxuICAgICAgICAgICAgam9iQWJvcnRlZEZ1bmM6IGpvYkFib3J0ZWRGdW5jLFxyXG4gICAgICAgICAgICBqb2JDb250ZXh0OiBqb2JDb250ZXh0XHJcbiAgICAgICAgfTtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgbWluUHJpb3JpdHkgPSBnZXRNaW5pbWFsUHJpb3JpdHlUb1NjaGVkdWxlKHRoaXMpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciByZXNvdXJjZSA9IG51bGw7XHJcbiAgICAgICAgaWYgKHByaW9yaXR5ID49IG1pblByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIHJlc291cmNlID0gdHJ5R2V0RnJlZVJlc291cmNlKHRoaXMpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAocmVzb3VyY2UgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgc2NoZWR1bGUodGhpcywgam9iLCByZXNvdXJjZSk7XHJcbiAgICAgICAgICAgIGxvZyh0aGlzLCAnZW5xdWV1ZUpvYigpIGVuZDogam9iIHNjaGVkdWxlZCcsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBlbnF1ZXVlTmV3Sm9iKHRoaXMsIGpvYiwgcHJpb3JpdHkpO1xyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQodGhpcyk7XHJcbiAgICAgICAgbG9nKHRoaXMsICdlbnF1ZXVlSm9iKCkgZW5kOiBqb2IgcGVuZGluZycsIC0xKTtcclxuICAgIH07XHJcblxyXG4gICAgZnVuY3Rpb24gam9iRG9uZUludGVybmFsKHNlbGYsIHJlc291cmNlLCBqb2JDb250ZXh0KSB7XHJcbiAgICAgICAgaWYgKHNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgdmFyIHByaW9yaXR5ID0gc2VsZi5fcHJpb3JpdGl6ZXIuZ2V0UHJpb3JpdHkoam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAnam9iRG9uZSgpIHN0YXJ0OiBqb2IgZG9uZSBvZiBwcmlvcml0eSAnICsgcHJpb3JpdHksICsxKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmVzb3VyY2VGcmVlZChzZWxmLCByZXNvdXJjZSk7XHJcbiAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICBsb2coc2VsZiwgJ2pvYkRvbmUoKSBlbmQnLCAtMSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHNob3VsZFlpZWxkT3JBYm9ydEludGVybmFsKHNlbGYsIGpvYkNvbnRleHQpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ3Nob3VsZFlpZWxkT3JBYm9ydCgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBwcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYkNvbnRleHQpO1xyXG4gICAgICAgIHZhciByZXN1bHQgPSAocHJpb3JpdHkgPCAwKSB8fCBoYXNOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoc2VsZiwgcHJpb3JpdHkpO1xyXG4gICAgICAgIGxvZyhzZWxmLCAnc2hvdWxkWWllbGRPckFib3J0KCkgZW5kJywgLTEpO1xyXG4gICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIHRyeVlpZWxkSW50ZXJuYWwoXHJcbiAgICAgICAgc2VsZiwgam9iQ29udGludWVGdW5jLCBqb2JDb250ZXh0LCBqb2JBYm9ydGVkRnVuYywgam9iWWllbGRlZEZ1bmMsIHJlc291cmNlKSB7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICd0cnlZaWVsZCgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBwcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYkNvbnRleHQpO1xyXG4gICAgICAgIGlmIChwcmlvcml0eSA8IDApIHtcclxuICAgICAgICAgICAgam9iQWJvcnRlZEZ1bmMoam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgIHJlc291cmNlRnJlZWQoc2VsZiwgcmVzb3VyY2UpO1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ3RyeVlpZWxkKCkgZW5kOiBqb2IgYWJvcnRlZCcsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICB2YXIgaGlnaGVyUHJpb3JpdHlKb2IgPSB0cnlEZXF1ZXVlTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KFxyXG4gICAgICAgICAgICBzZWxmLCBwcmlvcml0eSk7XHJcbiAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoaGlnaGVyUHJpb3JpdHlKb2IgPT09IG51bGwpIHtcclxuICAgICAgICAgICAgbG9nKHNlbGYsICd0cnlZaWVsZCgpIGVuZDogam9iIGNvbnRpbnVlcycsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBqb2JZaWVsZGVkRnVuYyhqb2JDb250ZXh0KTtcclxuXHJcbiAgICAgICAgdmFyIGpvYiA9IHtcclxuICAgICAgICAgICAgam9iRnVuYzogam9iQ29udGludWVGdW5jLFxyXG4gICAgICAgICAgICBqb2JBYm9ydGVkRnVuYzogam9iQWJvcnRlZEZ1bmMsXHJcbiAgICAgICAgICAgIGpvYkNvbnRleHQ6IGpvYkNvbnRleHRcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgZW5xdWV1ZU5ld0pvYihzZWxmLCBqb2IsIHByaW9yaXR5KTtcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG5cclxuICAgICAgICBzY2hlZHVsZShzZWxmLCBoaWdoZXJQcmlvcml0eUpvYiwgcmVzb3VyY2UpO1xyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICd0cnlZaWVsZCgpIGVuZDogam9iIHlpZWxkZWQnLCAtMSk7XHJcbiAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGhhc05ld0pvYldpdGhIaWdoZXJQcmlvcml0eShzZWxmLCBsb3dQcmlvcml0eSkge1xyXG4gICAgICAgIHZhciBjdXJyZW50Tm9kZSA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICdoYXNOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoKSBzdGFydCcsICsxKTtcclxuICAgICAgICBcclxuICAgICAgICB3aGlsZSAoY3VycmVudE5vZGUgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIG5leHROb2RlID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldE5leHRJdGVyYXRvcihcclxuICAgICAgICAgICAgICAgIGN1cnJlbnROb2RlKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB2YXIgam9iID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldEZyb21JdGVyYXRvcihjdXJyZW50Tm9kZSk7XHJcbiAgICAgICAgICAgIHZhciBwcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChwcmlvcml0eSA8IDApIHtcclxuICAgICAgICAgICAgICAgIGV4dHJhY3RKb2JGcm9tTGlua2VkTGlzdChzZWxmLCBjdXJyZW50Tm9kZSk7XHJcbiAgICAgICAgICAgICAgICAtLXNlbGYuX3BlbmRpbmdKb2JzQ291bnQ7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGpvYi5qb2JBYm9ydGVkRnVuYyhqb2Iuam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgICAgICBjdXJyZW50Tm9kZSA9IG5leHROb2RlO1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChwcmlvcml0eSA+IGxvd1ByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgICAgICBsb2coc2VsZiwgJ2hhc05ld0pvYldpdGhIaWdoZXJQcmlvcml0eSgpIGVuZDogcmV0dXJucyB0cnVlJywgLTEpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGN1cnJlbnROb2RlID0gbmV4dE5vZGU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAnaGFzTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KCkgZW5kOiByZXR1cm5zIGZhbHNlJywgLTEpO1xyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gdHJ5RGVxdWV1ZU5ld0pvYldpdGhIaWdoZXJQcmlvcml0eShzZWxmLCBsb3dQcmlvcml0eSkge1xyXG4gICAgICAgIGxvZyhzZWxmLCAndHJ5RGVxdWV1ZU5ld0pvYldpdGhIaWdoZXJQcmlvcml0eSgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBqb2JUb1NjaGVkdWxlTm9kZSA9IG51bGw7XHJcbiAgICAgICAgdmFyIGhpZ2hlc3RQcmlvcml0eUZvdW5kID0gbG93UHJpb3JpdHk7XHJcbiAgICAgICAgdmFyIGNvdW50ZWRQcmlvcml0aWVzID0gW107XHJcblxyXG4gICAgICAgIHZhciBjdXJyZW50Tm9kZSA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRGaXJzdEl0ZXJhdG9yKCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgd2hpbGUgKGN1cnJlbnROb2RlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIHZhciBuZXh0Tm9kZSA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXROZXh0SXRlcmF0b3IoXHJcbiAgICAgICAgICAgICAgICBjdXJyZW50Tm9kZSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgdmFyIGpvYiA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRGcm9tSXRlcmF0b3IoY3VycmVudE5vZGUpO1xyXG4gICAgICAgICAgICB2YXIgcHJpb3JpdHkgPSBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShqb2Iuam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAocHJpb3JpdHkgPCAwKSB7XHJcbiAgICAgICAgICAgICAgICBleHRyYWN0Sm9iRnJvbUxpbmtlZExpc3Qoc2VsZiwgY3VycmVudE5vZGUpO1xyXG4gICAgICAgICAgICAgICAgLS1zZWxmLl9wZW5kaW5nSm9ic0NvdW50O1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBqb2Iuam9iQWJvcnRlZEZ1bmMoam9iLmpvYkNvbnRleHQpO1xyXG4gICAgICAgICAgICAgICAgY3VycmVudE5vZGUgPSBuZXh0Tm9kZTtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoaGlnaGVzdFByaW9yaXR5Rm91bmQgPT09IHVuZGVmaW5lZCB8fFxyXG4gICAgICAgICAgICAgICAgcHJpb3JpdHkgPiBoaWdoZXN0UHJpb3JpdHlGb3VuZCkge1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBoaWdoZXN0UHJpb3JpdHlGb3VuZCA9IHByaW9yaXR5O1xyXG4gICAgICAgICAgICAgICAgam9iVG9TY2hlZHVsZU5vZGUgPSBjdXJyZW50Tm9kZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKCFzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgICAgICBjdXJyZW50Tm9kZSA9IG5leHROb2RlO1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChjb3VudGVkUHJpb3JpdGllc1twcmlvcml0eV0gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgY291bnRlZFByaW9yaXRpZXNbcHJpb3JpdHldID0gMTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICsrY291bnRlZFByaW9yaXRpZXNbcHJpb3JpdHldO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjdXJyZW50Tm9kZSA9IG5leHROb2RlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgam9iVG9TY2hlZHVsZSA9IG51bGw7XHJcbiAgICAgICAgaWYgKGpvYlRvU2NoZWR1bGVOb2RlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgIGpvYlRvU2NoZWR1bGUgPSBleHRyYWN0Sm9iRnJvbUxpbmtlZExpc3Qoc2VsZiwgam9iVG9TY2hlZHVsZU5vZGUpO1xyXG4gICAgICAgICAgICAtLXNlbGYuX3BlbmRpbmdKb2JzQ291bnQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgIHZhciBqb2JzTGlzdE1lc3NhZ2UgPSAndHJ5RGVxdWV1ZU5ld0pvYldpdGhIaWdoZXJQcmlvcml0eSgpOiBKb2JzIGxpc3Q6JztcclxuXHJcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY291bnRlZFByaW9yaXRpZXMubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgICAgIGlmIChjb3VudGVkUHJpb3JpdGllc1tpXSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgam9ic0xpc3RNZXNzYWdlICs9IGNvdW50ZWRQcmlvcml0aWVzW2ldICsgJyBqb2JzIG9mIHByaW9yaXR5ICcgKyBpICsgJzsnO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBsb2coc2VsZiwgam9ic0xpc3RNZXNzYWdlKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChqb2JUb1NjaGVkdWxlICE9PSBudWxsKSB7XHJcbiAgICAgICAgICAgICAgICBsb2coc2VsZiwgJ3RyeURlcXVldWVOZXdKb2JXaXRoSGlnaGVyUHJpb3JpdHkoKTogZGVxdWV1ZWQgbmV3IGpvYiBvZiBwcmlvcml0eSAnICsgaGlnaGVzdFByaW9yaXR5Rm91bmQpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICd0cnlEZXF1ZXVlTmV3Sm9iV2l0aEhpZ2hlclByaW9yaXR5KCkgZW5kJywgLTEpO1xyXG4gICAgICAgIHJldHVybiBqb2JUb1NjaGVkdWxlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiB0cnlHZXRGcmVlUmVzb3VyY2Uoc2VsZikge1xyXG4gICAgICAgIGxvZyhzZWxmLCAndHJ5R2V0RnJlZVJlc291cmNlKCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgaWYgKHNlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudCA9PT0gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgLS1zZWxmLl9mcmVlUmVzb3VyY2VzQ291bnQ7XHJcbiAgICAgICAgdmFyIHJlc291cmNlID0gc2VsZi5fZnJlZVJlc291cmNlcy5wb3AoKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAocmVzb3VyY2UgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICByZXNvdXJjZSA9IHNlbGYuX3Jlc291cmNlQ3JlYXRvcigpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAndHJ5R2V0RnJlZVJlc291cmNlKCkgZW5kJywgLTEpO1xyXG4gICAgICAgIHJldHVybiByZXNvdXJjZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gZW5xdWV1ZU5ld0pvYihzZWxmLCBqb2IsIHByaW9yaXR5KSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdlbnF1ZXVlTmV3Sm9iKCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgKytzZWxmLl9wZW5kaW5nSm9ic0NvdW50O1xyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBmaXJzdEl0ZXJhdG9yID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICBhZGRKb2JUb0xpbmtlZExpc3Qoc2VsZiwgam9iLCBmaXJzdEl0ZXJhdG9yKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ2VucXVldWVOZXdKb2IoKTogZW5xdWV1ZWQgam9iIG9mIHByaW9yaXR5ICcgKyBwcmlvcml0eSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Q291bnQoKSA8PSBzZWxmLl9udW1OZXdKb2JzKSB7XHJcbiAgICAgICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAnZW5xdWV1ZU5ld0pvYigpIGVuZDogX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdCBpcyBzbWFsbCBlbm91Z2gnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGxhc3RJdGVyYXRvciA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRMYXN0SXRlcmF0b3IoKTtcclxuICAgICAgICB2YXIgb2xkSm9iID0gZXh0cmFjdEpvYkZyb21MaW5rZWRMaXN0KHNlbGYsIGxhc3RJdGVyYXRvcik7XHJcbiAgICAgICAgZW5xdWV1ZU9sZEpvYihzZWxmLCBvbGRKb2IpO1xyXG4gICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgbG9nKHNlbGYsICdlbnF1ZXVlTmV3Sm9iKCkgZW5kOiBPbmUgam9iIG1vdmVkIGZyb20gbmV3IGpvYiBsaXN0IHRvIG9sZCBqb2IgbGlzdCcsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gZW5xdWV1ZU9sZEpvYihzZWxmLCBqb2IpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ2VucXVldWVPbGRKb2IoKSBzdGFydCcsICsxKTtcclxuICAgICAgICB2YXIgcHJpb3JpdHkgPSBzZWxmLl9wcmlvcml0aXplci5nZXRQcmlvcml0eShqb2Iuam9iQ29udGV4dCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHByaW9yaXR5IDwgMCkge1xyXG4gICAgICAgICAgICAtLXNlbGYuX3BlbmRpbmdKb2JzQ291bnQ7XHJcbiAgICAgICAgICAgIGpvYi5qb2JBYm9ydGVkRnVuYyhqb2Iuam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAnZW5xdWV1ZU9sZEpvYigpIGVuZDogam9iIGFib3J0ZWQnLCAtMSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtwcmlvcml0eV0gPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbcHJpb3JpdHldID0gW107XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtwcmlvcml0eV0ucHVzaChqb2IpO1xyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5xdWV1ZU9sZEpvYigpIGVuZDogam9iIGVucXVldWVkIHRvIG9sZCBqb2IgbGlzdCcsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gcmVyYW5rUHJpb3JpdGllcyhzZWxmKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdyZXJhbmtQcmlvcml0aWVzKCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgdmFyIG9yaWdpbmFsT2xkc0FycmF5ID0gc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5O1xyXG4gICAgICAgIHZhciBvcmlnaW5hbE5ld3NMaXN0ID0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChvcmlnaW5hbE9sZHNBcnJheS5sZW5ndGggPT09IDApIHtcclxuICAgICAgICAgICAgbG9nKHNlbGYsICdyZXJhbmtQcmlvcml0aWVzKCkgZW5kOiBubyBuZWVkIHRvIHJlcmFuaycsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHkgPSBbXTtcclxuICAgICAgICBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QgPSBuZXcgTGlua2VkTGlzdCgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgb3JpZ2luYWxPbGRzQXJyYXkubGVuZ3RoOyArK2kpIHtcclxuICAgICAgICAgICAgaWYgKG9yaWdpbmFsT2xkc0FycmF5W2ldID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IG9yaWdpbmFsT2xkc0FycmF5W2ldLmxlbmd0aDsgKytqKSB7XHJcbiAgICAgICAgICAgICAgICBlbnF1ZXVlT2xkSm9iKHNlbGYsIG9yaWdpbmFsT2xkc0FycmF5W2ldW2pdKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSBvcmlnaW5hbE5ld3NMaXN0LmdldEZpcnN0SXRlcmF0b3IoKTtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgdmFyIHZhbHVlID0gb3JpZ2luYWxOZXdzTGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgICAgICBlbnF1ZXVlT2xkSm9iKHNlbGYsIHZhbHVlKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGl0ZXJhdG9yID0gb3JpZ2luYWxOZXdzTGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgbWVzc2FnZSA9ICdyZXJhbmtQcmlvcml0aWVzKCk6ICc7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZm9yICh2YXIgayA9IHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eS5sZW5ndGggLSAxOyBrID49IDA7IC0taykge1xyXG4gICAgICAgICAgICB2YXIgaGlnaFByaW9yaXR5Sm9icyA9IHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eVtrXTtcclxuICAgICAgICAgICAgaWYgKGhpZ2hQcmlvcml0eUpvYnMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgICAgICBtZXNzYWdlICs9IGhpZ2hQcmlvcml0eUpvYnMubGVuZ3RoICsgJyBqb2JzIGluIHByaW9yaXR5ICcgKyBrICsgJzsnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB3aGlsZSAoaGlnaFByaW9yaXR5Sm9icy5sZW5ndGggPiAwICYmXHJcbiAgICAgICAgICAgICAgICAgICAgc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldENvdW50KCkgPCBzZWxmLl9udW1OZXdKb2JzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB2YXIgam9iID0gaGlnaFByaW9yaXR5Sm9icy5wb3AoKTtcclxuICAgICAgICAgICAgICAgIGFkZEpvYlRvTGlua2VkTGlzdChzZWxmLCBqb2IpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldENvdW50KCkgPj0gc2VsZi5fbnVtTmV3Sm9icyAmJlxyXG4gICAgICAgICAgICAgICAgIXNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCBtZXNzYWdlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICBsb2coc2VsZiwgJ3JlcmFua1ByaW9yaXRpZXMoKSBlbmQ6IHJlcmFuayBkb25lJywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiByZXNvdXJjZUZyZWVkKHNlbGYsIHJlc291cmNlKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdyZXNvdXJjZUZyZWVkKCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgKytzZWxmLl9mcmVlUmVzb3VyY2VzQ291bnQ7XHJcbiAgICAgICAgdmFyIG1pblByaW9yaXR5ID0gZ2V0TWluaW1hbFByaW9yaXR5VG9TY2hlZHVsZShzZWxmKTtcclxuICAgICAgICAtLXNlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudDtcclxuICAgICAgICBcclxuICAgICAgICB2YXIgam9iID0gdHJ5RGVxdWV1ZU5ld0pvYldpdGhIaWdoZXJQcmlvcml0eShzZWxmLCBtaW5Qcmlvcml0eSk7XHJcblxyXG4gICAgICAgIGlmIChqb2IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICAgICAgc2NoZWR1bGUoc2VsZiwgam9iLCByZXNvdXJjZSk7XHJcbiAgICAgICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ3Jlc291cmNlRnJlZWQoKSBlbmQ6IG5ldyBqb2Igc2NoZWR1bGVkJywgLTEpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBoYXNPbGRKb2JzID1cclxuICAgICAgICAgICAgc2VsZi5fcGVuZGluZ0pvYnNDb3VudCA+IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRDb3VudCgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICBpZiAoIWhhc09sZEpvYnMpIHtcclxuICAgICAgICAgICAgc2VsZi5fZnJlZVJlc291cmNlcy5wdXNoKHJlc291cmNlKTtcclxuICAgICAgICAgICAgKytzZWxmLl9mcmVlUmVzb3VyY2VzQ291bnQ7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ3Jlc291cmNlRnJlZWQoKSBlbmQ6IG5vIGpvYiB0byBzY2hlZHVsZScsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB2YXIgbnVtUHJpb3JpdGllcyA9IHNlbGYuX29sZFBlbmRpbmdKb2JzQnlQcmlvcml0eS5sZW5ndGg7XHJcbiAgICAgICAgdmFyIGpvYlByaW9yaXR5O1xyXG4gICAgICAgIFxyXG4gICAgICAgIGZvciAodmFyIHByaW9yaXR5ID0gbnVtUHJpb3JpdGllcyAtIDE7IHByaW9yaXR5ID49IDA7IC0tcHJpb3JpdHkpIHtcclxuICAgICAgICAgICAgdmFyIGpvYnMgPSBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbcHJpb3JpdHldO1xyXG4gICAgICAgICAgICBpZiAoam9icyA9PT0gdW5kZWZpbmVkIHx8IGpvYnMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IGpvYnMubGVuZ3RoIC0gMTsgaSA+PSAwOyAtLWkpIHtcclxuICAgICAgICAgICAgICAgIGpvYiA9IGpvYnNbaV07XHJcbiAgICAgICAgICAgICAgICBqb2JQcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgICAgIGlmIChqb2JQcmlvcml0eSA+PSBwcmlvcml0eSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGpvYnMubGVuZ3RoID0gaTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAoam9iUHJpb3JpdHkgPCAwKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLS1zZWxmLl9wZW5kaW5nSm9ic0NvdW50O1xyXG4gICAgICAgICAgICAgICAgICAgIGpvYi5qb2JBYm9ydGVkRnVuYyhqb2Iuam9iQ29udGV4dCk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbam9iUHJpb3JpdHldID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5W2pvYlByaW9yaXR5XSA9IFtdO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBzZWxmLl9vbGRQZW5kaW5nSm9ic0J5UHJpb3JpdHlbam9iUHJpb3JpdHldLnB1c2goam9iKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgam9iID0gbnVsbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGpvYiAhPT0gbnVsbCkge1xyXG4gICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGpvYnMubGVuZ3RoID0gMDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKGpvYiA9PT0gbnVsbCkge1xyXG4gICAgICAgICAgICBzZWxmLl9mcmVlUmVzb3VyY2VzLnB1c2gocmVzb3VyY2UpO1xyXG4gICAgICAgICAgICArK3NlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ3Jlc291cmNlRnJlZWQoKSBlbmQ6IG5vIG5vbi1hYm9ydGVkIGpvYiB0byBzY2hlZHVsZScsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICBsb2coc2VsZiwgJ3Jlc291cmNlRnJlZWQoKTogZGVxdWV1ZWQgb2xkIGpvYiBvZiBwcmlvcml0eSAnICsgam9iUHJpb3JpdHkpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAtLXNlbGYuX3BlbmRpbmdKb2JzQ291bnQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgZW5zdXJlUGVuZGluZ0pvYnNDb3VudChzZWxmKTtcclxuICAgICAgICBzY2hlZHVsZShzZWxmLCBqb2IsIHJlc291cmNlKTtcclxuICAgICAgICBlbnN1cmVQZW5kaW5nSm9ic0NvdW50KHNlbGYpO1xyXG4gICAgICAgIGxvZyhzZWxmLCAncmVzb3VyY2VGcmVlZCgpIGVuZDogam9iIHNjaGVkdWxlZCcsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gc2NoZWR1bGUoc2VsZiwgam9iLCByZXNvdXJjZSkge1xyXG4gICAgICAgIGxvZyhzZWxmLCAnc2NoZWR1bGUoKSBzdGFydCcsICsxKTtcclxuICAgICAgICArK3NlbGYuX3NjaGVkdWxlc0NvdW50ZXI7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKHNlbGYuX3NjaGVkdWxlc0NvdW50ZXIgPj0gc2VsZi5fbnVtSm9ic0JlZm9yZVJlcmFua09sZFByaW9yaXRpZXMpIHtcclxuICAgICAgICAgICAgc2VsZi5fc2NoZWR1bGVzQ291bnRlciA9IDA7XHJcbiAgICAgICAgICAgIHJlcmFua1ByaW9yaXRpZXMoc2VsZik7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9zaG93TG9nKSB7XHJcbiAgICAgICAgICAgIHZhciBwcmlvcml0eSA9IHNlbGYuX3ByaW9yaXRpemVyLmdldFByaW9yaXR5KGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICAgICAgbG9nKHNlbGYsICdzY2hlZHVsZSgpOiBzY2hlZHVsZWQgam9iIG9mIHByaW9yaXR5ICcgKyBwcmlvcml0eSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHZhciBjYWxsYmFja3MgPSBuZXcgUHJpb3JpdHlTY2hlZHVsZXJDYWxsYmFja3Moc2VsZiwgcmVzb3VyY2UsIGpvYi5qb2JDb250ZXh0KTtcclxuICAgICAgICBcclxuICAgICAgICBqb2Iuam9iRnVuYyhyZXNvdXJjZSwgam9iLmpvYkNvbnRleHQsIGNhbGxiYWNrcyk7XHJcbiAgICAgICAgbG9nKHNlbGYsICdzY2hlZHVsZSgpIGVuZCcsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gYWRkSm9iVG9MaW5rZWRMaXN0KHNlbGYsIGpvYiwgYWRkQmVmb3JlKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdhZGRKb2JUb0xpbmtlZExpc3QoKSBzdGFydCcsICsxKTtcclxuICAgICAgICBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuYWRkKGpvYiwgYWRkQmVmb3JlKTtcclxuICAgICAgICBlbnN1cmVOdW1iZXJPZk5vZGVzKHNlbGYpO1xyXG4gICAgICAgIGxvZyhzZWxmLCAnYWRkSm9iVG9MaW5rZWRMaXN0KCkgZW5kJywgLTEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBleHRyYWN0Sm9iRnJvbUxpbmtlZExpc3Qoc2VsZiwgaXRlcmF0b3IpIHtcclxuICAgICAgICBsb2coc2VsZiwgJ2V4dHJhY3RKb2JGcm9tTGlua2VkTGlzdCgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciB2YWx1ZSA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXRGcm9tSXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5yZW1vdmUoaXRlcmF0b3IpO1xyXG4gICAgICAgIGVuc3VyZU51bWJlck9mTm9kZXMoc2VsZik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbG9nKHNlbGYsICdleHRyYWN0Sm9iRnJvbUxpbmtlZExpc3QoKSBlbmQnLCAtMSk7XHJcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBlbnN1cmVOdW1iZXJPZk5vZGVzKHNlbGYpIHtcclxuICAgICAgICBpZiAoIXNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ2Vuc3VyZU51bWJlck9mTm9kZXMoKSBzdGFydCcsICsxKTtcclxuICAgICAgICB2YXIgaXRlcmF0b3IgPSBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Rmlyc3RJdGVyYXRvcigpO1xyXG4gICAgICAgIHZhciBleHBlY3RlZENvdW50ID0gMDtcclxuICAgICAgICB3aGlsZSAoaXRlcmF0b3IgIT09IG51bGwpIHtcclxuICAgICAgICAgICAgKytleHBlY3RlZENvdW50O1xyXG4gICAgICAgICAgICBpdGVyYXRvciA9IHNlbGYuX25ld1BlbmRpbmdKb2JzTGlua2VkTGlzdC5nZXROZXh0SXRlcmF0b3IoaXRlcmF0b3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoZXhwZWN0ZWRDb3VudCAhPT0gc2VsZi5fbmV3UGVuZGluZ0pvYnNMaW5rZWRMaXN0LmdldENvdW50KCkpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgY291bnQgb2YgbmV3IGpvYnMnO1xyXG4gICAgICAgIH1cclxuICAgICAgICBsb2coc2VsZiwgJ2Vuc3VyZU51bWJlck9mTm9kZXMoKSBlbmQnLCAtMSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIGVuc3VyZVBlbmRpbmdKb2JzQ291bnQoc2VsZikge1xyXG4gICAgICAgIGlmICghc2VsZi5fc2hvd0xvZykge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5zdXJlUGVuZGluZ0pvYnNDb3VudCgpIHN0YXJ0JywgKzEpO1xyXG4gICAgICAgIHZhciBvbGRKb2JzQ291bnQgPSAwO1xyXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5Lmxlbmd0aDsgKytpKSB7XHJcbiAgICAgICAgICAgIHZhciBqb2JzID0gc2VsZi5fb2xkUGVuZGluZ0pvYnNCeVByaW9yaXR5W2ldO1xyXG4gICAgICAgICAgICBpZiAoam9icyAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAgICAgICBvbGRKb2JzQ291bnQgKz0gam9icy5sZW5ndGg7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdmFyIGV4cGVjdGVkQ291bnQgPVxyXG4gICAgICAgICAgICBvbGRKb2JzQ291bnQgKyBzZWxmLl9uZXdQZW5kaW5nSm9ic0xpbmtlZExpc3QuZ2V0Q291bnQoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgaWYgKGV4cGVjdGVkQ291bnQgIT09IHNlbGYuX3BlbmRpbmdKb2JzQ291bnQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1VuZXhwZWN0ZWQgY291bnQgb2Ygam9icyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGxvZyhzZWxmLCAnZW5zdXJlUGVuZGluZ0pvYnNDb3VudCgpIGVuZCcsIC0xKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgZnVuY3Rpb24gZ2V0TWluaW1hbFByaW9yaXR5VG9TY2hlZHVsZShzZWxmKSB7XHJcbiAgICAgICAgbG9nKHNlbGYsICdnZXRNaW5pbWFsUHJpb3JpdHlUb1NjaGVkdWxlKCkgc3RhcnQnLCArMSk7XHJcbiAgICAgICAgaWYgKHNlbGYuX2ZyZWVSZXNvdXJjZXNDb3VudCA8PSBzZWxmLl9yZXNvdXJjZXNHdWFyYW50ZWVkRm9ySGlnaFByaW9yaXR5KSB7XHJcbiAgICAgICAgICAgIGxvZyhzZWxmLCAnZ2V0TWluaW1hbFByaW9yaXR5VG9TY2hlZHVsZSgpIGVuZDogZ3VhcmFudGVlIHJlc291cmNlIGZvciBoaWdoIHByaW9yaXR5IGlzIG5lZWRlZCcsIC0xKTtcclxuICAgICAgICAgICAgcmV0dXJuIHNlbGYuX2hpZ2hQcmlvcml0eVRvR3VhcmFudGVlUmVzb3VyY2VzO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBsb2coc2VsZiwgJ2dldE1pbmltYWxQcmlvcml0eVRvU2NoZWR1bGUoKSBlbmQ6IGVub3VnaCByZXNvdXJjZXMsIG5vIG5lZWQgdG8gZ3VhcmFudGVlIHJlc291cmNlIGZvciBoaWdoIHByaW9yaXR5JywgLTEpO1xyXG4gICAgICAgIHJldHVybiAwO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBmdW5jdGlvbiBsb2coc2VsZiwgbXNnLCBhZGRJbmRlbnQpIHtcclxuICAgICAgICBpZiAoIXNlbGYuX3Nob3dMb2cpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpZiAoYWRkSW5kZW50ID09PSAtMSkge1xyXG4gICAgICAgICAgICBzZWxmLl9sb2dDYWxsSW5kZW50UHJlZml4ID0gc2VsZi5fbG9nQ2FsbEluZGVudFByZWZpeC5zdWJzdHIoMSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGlmIChzZWxmLl9zY2hlZHVsZXJOYW1lICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgLyogZ2xvYmFsIGNvbnNvbGU6IGZhbHNlICovXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHNlbGYuX2xvZ0NhbGxJbmRlbnRQcmVmaXggKyAnUHJpb3JpdHlTY2hlZHVsZXIgJyArIHNlbGYuX3NjaGVkdWxlck5hbWUgKyAnOiAnICsgbXNnKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAvKiBnbG9iYWwgY29uc29sZTogZmFsc2UgKi9cclxuICAgICAgICAgICAgY29uc29sZS5sb2coc2VsZi5fbG9nQ2FsbEluZGVudFByZWZpeCArICdQcmlvcml0eVNjaGVkdWxlcjogJyArIG1zZyk7XHJcbiAgICAgICAgfVxyXG4gICAgXHJcbiAgICAgICAgaWYgKGFkZEluZGVudCA9PT0gMSkge1xyXG4gICAgICAgICAgICBzZWxmLl9sb2dDYWxsSW5kZW50UHJlZml4ICs9ICc+JztcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGZ1bmN0aW9uIFByaW9yaXR5U2NoZWR1bGVyQ2FsbGJhY2tzKHNjaGVkdWxlciwgcmVzb3VyY2UsIGNvbnRleHQpIHtcclxuICAgICAgICB0aGlzLl9pc1ZhbGlkID0gdHJ1ZTtcclxuICAgICAgICB0aGlzLl9zY2hlZHVsZXIgPSBzY2hlZHVsZXI7XHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2UgPSByZXNvdXJjZTtcclxuICAgICAgICB0aGlzLl9jb250ZXh0ID0gY29udGV4dDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgUHJpb3JpdHlTY2hlZHVsZXJDYWxsYmFja3MucHJvdG90eXBlLl9jaGVja1ZhbGlkaXR5ID0gZnVuY3Rpb24gY2hlY2tWYWxpZGl0eSgpIHtcclxuICAgICAgICBpZiAoIXRoaXMuX2lzVmFsaWQpIHtcclxuICAgICAgICAgICAgdGhyb3cgJ1Jlc291cmNlU2NoZWR1bGVyIGVycm9yOiBBbHJlYWR5IHRlcm1pbmF0ZWQgam9iJztcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuX2NsZWFyVmFsaWRpdHkgPSBmdW5jdGlvbigpIHtcclxuICAgICAgICB0aGlzLl9pc1ZhbGlkID0gZmFsc2U7XHJcbiAgICAgICAgdGhpcy5fcmVzb3VyY2UgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX2NvbnRleHQgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuX3NjaGVkdWxlciA9IG51bGw7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuam9iRG9uZSA9IGZ1bmN0aW9uIGpvYkRvbmUoKSB7XHJcbiAgICAgICAgdGhpcy5fY2hlY2tWYWxpZGl0eSgpO1xyXG4gICAgICAgIGpvYkRvbmVJbnRlcm5hbCh0aGlzLl9zY2hlZHVsZXIsIHRoaXMuX3Jlc291cmNlLCB0aGlzLl9jb250ZXh0KTtcclxuICAgICAgICB0aGlzLl9jbGVhclZhbGlkaXR5KCk7XHJcbiAgICB9O1xyXG4gICAgXHJcbiAgICBQcmlvcml0eVNjaGVkdWxlckNhbGxiYWNrcy5wcm90b3R5cGUuc2hvdWxkWWllbGRPckFib3J0ID0gZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgdGhpcy5fY2hlY2tWYWxpZGl0eSgpO1xyXG4gICAgICAgIHJldHVybiBzaG91bGRZaWVsZE9yQWJvcnRJbnRlcm5hbCh0aGlzLl9zY2hlZHVsZXIsIHRoaXMuX2NvbnRleHQpO1xyXG4gICAgfTtcclxuICAgIFxyXG4gICAgUHJpb3JpdHlTY2hlZHVsZXJDYWxsYmFja3MucHJvdG90eXBlLnRyeVlpZWxkID0gZnVuY3Rpb24gdHJ5WWllbGQoam9iQ29udGludWVGdW5jLCBqb2JBYm9ydGVkRnVuYywgam9iWWllbGRlZEZ1bmMpIHtcclxuICAgICAgICB0aGlzLl9jaGVja1ZhbGlkaXR5KCk7XHJcbiAgICAgICAgdmFyIGlzWWllbGRlZCA9IHRyeVlpZWxkSW50ZXJuYWwoXHJcbiAgICAgICAgICAgIHRoaXMuX3NjaGVkdWxlciwgam9iQ29udGludWVGdW5jLCB0aGlzLl9jb250ZXh0LCBqb2JBYm9ydGVkRnVuYywgam9iWWllbGRlZEZ1bmMsIHRoaXMuX3Jlc291cmNlKTtcclxuICAgICAgICBpZiAoaXNZaWVsZGVkKSB7XHJcbiAgICAgICAgICAgIHRoaXMuX2NsZWFyVmFsaWRpdHkoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuIGlzWWllbGRlZDtcclxuICAgIH07XHJcblxyXG4gICAgcmV0dXJuIFByaW9yaXR5U2NoZWR1bGVyO1xyXG59KSgpO1xyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBQcmlvcml0eVNjaGVkdWxlcjsiLCIndXNlIHN0cmljdCc7XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5Qcmlvcml0eVNjaGVkdWxlciA9IHJlcXVpcmUoJ3ByaW9yaXR5LXNjaGVkdWxlcicpO1xyXG5tb2R1bGUuZXhwb3J0cy5MaWZvU2NoZWR1bGVyID0gcmVxdWlyZSgnbGlmby1zY2hlZHVsZXInKTtcclxuIl19

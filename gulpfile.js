'use strict';

var browserify = require('browserify');
var gulp = require('gulp');
var source = require('vinyl-source-stream');
var buffer = require('vinyl-buffer');
var uglify = require('gulp-uglify');
var sourcemaps = require('gulp-sourcemaps');
var gutil = require('gulp-util');
var rename = require('gulp-rename');
var addsrc = require('gulp-add-src');
var concat = require('gulp-concat');
var jshint = require('gulp-jshint');
var filter = require('gulp-filter');
var mergeStream = require('merge-stream');

var sources = [
	//'./src/async-proxy-script-blob.js',
    './src/sub-worker-emulation-for-chrome.js ',
    './src/async-proxy-factory.js',
    './src/async-proxy-master.js',
    './src/async-proxy-slave.js',
    './src/scripts-to-import-pool.js',
    './src/dependency-workers/linked-list.js',
    './src/dependency-workers/hash-map.js dependency-workers/js-builtin-hash-map.js',
    './src/dependency-workers/dependency-workers-task.js',
    './src/dependency-workers/dependency-workers.js',
    './src/dependency-workers/dependency-workers-task-handle.js',
    './src/dependency-workers/dependency-workers-internal-context.js',
    './src/dependency-workers/wrapper-input-retreiver-base.js',
    './src/dependency-workers/scheduler-task.js',
    './src/dependency-workers/scheduler-wrapper-input-retreiver.js',
    './src/dependency-workers/scheduler-dependency-workers.js'
];

var vendorsProd = [
    './vendor/resource-scheduler.dev.js'
];

var vendorsDebug = [
    './vendor/resource-scheduler.dev.debug.js'
];

var scriptsDebug = vendorsDebug.concat(sources);
var scriptsProd = vendorsProd.concat(sources);

function build(isDebug) {
    var browserified = browserify({
        entries: ['./src/async-proxy-exports.js'],
        paths: [
            './src',
            './src/dependency-workers'
        ],
        standalone: 'async-proxy',
        debug: isDebug
    });
    
    var scripts = isDebug ? scriptsDebug : scriptsProd;
    var vendors = isDebug ? vendorsDebug : vendorsProd;
    var jshintStream = gulp.src(scripts)
        //.pipe(sourcemaps.init({ loadMaps: true }))
        .pipe(buffer())
        .pipe(jshint())
        .pipe(jshint.reporter('default'));
    
    var browserifyStream = browserified
        .bundle()
        .pipe(source('async-proxy.src.js'))
        .pipe(buffer());
    
    if (!isDebug) {
        browserifyStream = browserifyStream
        .pipe(uglify())
        .on('error', gutil.log);
    }
    for (var i = 0; i < vendors.length; ++i) {
        browserifyStream = browserifyStream.pipe(addsrc(vendors[i]));
    }
    
    var outFile = isDebug ? 'async-proxy.dev.debug' : 'async-proxy.dev';
    
    browserifyStream = browserifyStream
        .pipe(concat('async-proxy.src.js'))
        .pipe(rename(outFile + '.js'))
        //.pipe(sourcemaps.write(outFile + '.js.map'))
        .pipe(gulp.dest('./'));

    //return jshintStream;
    return mergeStream(jshintStream, browserifyStream);
}

gulp.task('debug', function () {
    return build(/*isDebug=*/true);
});

gulp.task('prod', function() {
    return build(/*isDebug=*/false);
});

gulp.task('default', ['debug', 'prod']);
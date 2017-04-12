var config = require('config')
var keypress = require('keypress');
//var program = require('commander');
var rp = require('request-promise');

auth = "=";// + new Buffer(username + ":" + password).toString("base64");
const JIRAWORKLOG = '/rest/tempo-timesheets/3/worklogs';

// make `process.stdin` begin emitting "keypress" events 
keypress(process.stdin); 
// listen for the "keypress" event 
process.stdin.on('keypress', function (ch, key) {
	if (key && key.ctrl && key.name == 'c') {
    	process.stdin.pause();
	}
	var dateFrom = '2017-04-01';
	var dateTo = '2017-04-30';

	if (key && key.name == 'space') {
		// Get worklogs
		var pAll = Promise.all([rp(tele2Work(dateFrom, dateTo)),rp(compWork(dateFrom, dateTo))]);
		pAll.then(function(r) {
			console.log(r);

		}, function(err) {
			console.log(err);
		});
		console.log('TSET');
		// Diff

		// Apply
	}

	// Get self
	if (key && key.name == 's') {
		rp(compSelf).then(function (body) {
		  console.log(body);
		}).catch(function (err) {
			throw new Error(err);
		});
	}
	// Get worklog - tele2
	if (key && key.name == 'd') {
		rp(tele2Work).then(function (body) {
		  console.log(body);
		}).catch(function (err) {
			throw new Error(err);
		});
	}
	// Get worklog - comp
	if (key && key.name == 'g') {
		rp(compWork).then(function (body) {
		  console.log(body);
		}).catch(function (err) {
			throw new Error(err);
		});
	}
	// Post worklog - comp
	if (key && key.name == 'h') {
		var options = { method: 'POST',
			  url: config.CompentusURL + JIRAWORKLOG,
			  headers: 
			   { 'cache-control': 'no-cache',
			     'content-type': 'application/json',
			     authorization: auth,
			     accept: 'application/json' },
			  body: 
			   { timeSpentSeconds: 1800,
			     dateStarted: '2017-04-04T00:00:00.000',
			     comment: 'Fasttrack',
			     author: 
			      { self: 'https://compentus.atlassian.net/rest/api/2/user?username=martin.larka',
			        name: 'martin.larka' },
			     issue: { key: 'T2-6', remainingEstimateSeconds: 0 },
			     worklogAttributes: [],
			     workAttributeValues: [] },
			  json: true };

		rp(options).then(function (body) {
		  console.log(body);
		}).catch(function (err) {
			throw new Error(err);
		});
	}
});

function compSelf() {
	return { method: 'GET',
		  	url:  config.CompentusURL + '/rest/auth/1/session',
			headers: 
			   	{ 'cache-control': 'no-cache',
			   	authorization: auth,
			   	accept: 'application/json' } };
}

function tele2Work(from, to) {
	return { method: 'GET',
		  url: config.Tele2URL + JIRAWORKLOG,
		  qs: 
		   { username: 'martlark',
		     dateFrom: from,
		     dateTo: to },
		  headers: 
		   { 'cache-control': 'no-cache',
		   	 authorization: '',
		     accept: 'application/json' } 
		 };
}

function compWork(from, to) {
	return { method: 'GET',
		  url: config.CompentusURL + JIRAWORKLOG,
		  qs: 
		   { username: 'martin.larka',
		     dateFrom: from,
		     dateTo: to },
		  headers: 
		   { 'cache-control': 'no-cache',
		     authorization: auth,
		     accept: 'application/json' } };
}

process.stdin.setRawMode(true);
process.stdin.resume();

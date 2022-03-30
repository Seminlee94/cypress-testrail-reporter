const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const TestRailLogger = require('./testrail.logger');
const TestRailCache = require('./testrail.cache');
import { RSA_NO_PADDING } from 'constants';
import { TestRailOptions, TestRailResult } from './testrail.interface';
import { CypressTestRailReporter } from './cypress-testrail-reporter'
import moment = require('moment');

export class TestRail {
  private base: String;
  private runId: Number;
  private includeAll: Boolean = true;
  private caseIds: Number[] = [];
  private retries: number;
  private runExists: Boolean = false;
  public executionDateTime = moment().format('dddd, MMMM Do YYYY');


  constructor(private options: TestRailOptions) {
    this.base = `${options.host}/index.php?/api/v2`;
    this.runId;
  }

  public getCases (suiteId: number, nextURL: boolean | string, cases: Number[], resolve, reject) {
    let url = `${this.base}/get_cases/${this.options.projectId}&suite_id=${suiteId}`

    if (nextURL) {
      url += nextURL;
    }
    if (this.options.groupId) {
      url += `&section_id=${this.options.groupId}`
    }
    if (this.options.filter) {
      url += `&filter=${this.options.filter}`
    }
    if (this.options.typeId) {
      url += `&type_id=${this.options.typeId}`
    }
    return axios({
        method:'get',
        url: url,
        headers: {
          'Content-Type': 'application/json',
          'x-api-ident' : 'beta'
        },
        auth: {
            username: this.options.username,
            password: this.options.password
        }
      })
      .then(response => {
        const retrievedCases = cases.concat(response.data.cases.map(item =>item.id));
        if (response.data._links.next !== null) {
          this.getCases(suiteId, response.data._links.next, retrievedCases, resolve, reject)
        } else {
          resolve(retrievedCases)
        }
      })
      .catch(error => {
        console.error(error);
        reject([])
      })
  }

  public createRun (name: string, description: string, suiteId: number) {
    console.log("runExists", this.runExists);
    if (!this.runExists) {
      console.log("Creating Run...");
      new Promise<Number[]>((resolve, reject) => {
        this.getCases(suiteId, null, [], resolve, reject)}).then(response => {
          console.log('Creating run with following cases: ', response);
          this.caseIds = response;
          this.addRun(name, description, suiteId);
        })
    } else {
      this.updateRuns(this.caseIds)
    }
    
    // if (this.options.includeAllInTestRun === false){
    //   this.includeAll = false;
      
    //   new Promise<Number[]>((resolve, reject) => {
    //     this.getCases(suiteId, null, [], resolve, reject)}).then(response => {
    //       console.log('Creating run with following cases:');
    //       console.debug(response);
    //       this.caseIds = response;
    //       this.addRun(name, description, suiteId);
    //     })
    //   } 
    //   else {
    //     this.addRun(name, description, suiteId).then(() => {
    //       this.getRuns();
    //     })
    //   }
    }
    
  public addRun(name: string, description: string, suiteId: number) {
    console.log("Adding Run...");
    return axios({
      method: 'post',
      url: `${this.base}/add_run/${this.options.projectId}`,
      headers: { 'Content-Type': 'application/json' },
      auth: {
        username: this.options.username,
        password: this.options.password,
      },
      data: JSON.stringify({
        suite_id: suiteId,
        name,
        description,
        include_all: this.includeAll,
        case_ids: this.caseIds
      }),
    })
    .then(response => {
        this.runId = response.data.id;
        // cache the TestRail Run ID
        TestRailCache.store('runId', this.runId);
    })
    .then(() => {
      this.getRuns();
    })
    .catch(error => {console.error(error)});
  }

  public getRuns() {
    console.log("Getting runs...")
    return axios({
      method:'get',
      url: `${this.base}/get_runs/${this.options.projectId}`,
      headers: { 
        'Content-Type': 'application/json',
        'x-api-ident': 'beta'
      },
      auth: {
          username: this.options.username,
          password: this.options.password
      }
    })
    .then((res) => {
      if (res.data.runs.some(run => run["name"].includes(this.executionDateTime))) {
        this.runExists = true;
      }
    })
    .catch((error) => {console.log("ERROR@@", error)});
  }

  public updateRuns(caseIds) {
    console.log("updating runs...")
    this.runId = TestRailCache.retrieve('runId');
    return axios({
      method:'post',
      url: `${this.base}/update_run/${this.runId}`,
      headers: { 
        'Content-Type': 'application/json',
        'x-api-ident': 'beta'
      },
      auth: {
          username: this.options.username,
          password: this.options.password
      },
      data: JSON.stringify({ 
        "case_ids": caseIds
       })
    })
    .then((res) => {
      console.log("update res", res)
    })
    .catch((error) => {console.log("ERROR@@", error)});
  }

  public deleteRun() {
    this.runId = TestRailCache.retrieve('runId');
    axios({
      method: 'post',
      url: `${this.base}/delete_run/${this.runId}`,
      headers: { 'Content-Type': 'application/json' },
      auth: {
        username: this.options.username,
        password: this.options.password,
      },
    }).catch(error => console.error(error))
  }

  public publishResults(results: TestRailResult[]) {
    this.runId = TestRailCache.retrieve('runId');
    return axios({
        method: 'post',
        url: `${this.base}/add_results_for_cases/${this.runId}`,
        headers: { 'Content-Type': 'application/json' },
        auth: {
          username: this.options.username,
          password: this.options.password,
        },
        data: JSON.stringify({ results }),
      })
      .then(response => response.data)
      .catch(error => { 
        console.error(error); 
      })
  }

  public publishResult(results: TestRailResult){
    this.runId = TestRailCache.retrieve('runId');
    return axios.post(
      `${this.base}/add_results_for_cases/${this.runId}`,
      {
        results: [{ case_id: results.case_id, status_id: results.status_id, comment: results.comment }],
      },
      {
        auth: {
          username: this.options.username,
          password: this.options.password,
        },
      }
      ).then(response => {
        console.log("Publishing following results:")
        console.debug(response.data)
        return response.data
      })
      .catch(error => {
        console.error(error);
    })
  }

  public uploadAttachment (resultId, path) {
    const form = new FormData();
    form.append('attachment', fs.createReadStream(path));

    axios({
        method: 'post',
        url: `${this.base}/add_attachment_to_result/${resultId}`,
        headers: { ...form.getHeaders() },
        auth: {
          username: this.options.username,
          password: this.options.password,
        },
        data: form,
      }).then(response => {
        console.log("Uploading screenshot...")
        console.debug(response.data)
      })
      .catch(error => {
        console.error(error);
    })
  }

  // This function will attach failed screenshot on each test result(comment) if founds it
  public uploadScreenshots (caseId, resultId) {
    const SCREENSHOTS_FOLDER_PATH = path.join(__dirname, '../../../screenshots');

    fs.readdir(SCREENSHOTS_FOLDER_PATH, (err, folders) => {
      console.log("Found screenshots for following sections:");
      console.debug(folders);
      if (err) {
        return console.log('Unable to scan screenshots folder: ' + err);
      }
      folders.forEach(folder => {
        fs.readdir(SCREENSHOTS_FOLDER_PATH + `/${folder}`, (err, spec) => {
          if (err) {
            return console.log('Unable to scan screenshots folder: ' + err);
          }
          spec.forEach(spec => {
            fs.readdir(SCREENSHOTS_FOLDER_PATH + `/${folder}/${spec}`, (err, file) => {
              if (err) {
                return console.log('Unable to scan screenshots folder: ' + err);
              }

              console.log("Found following screenshots");
              console.debug(file);

              file.forEach(file => {
                if (file.includes(`C${caseId}`) && /(failed|attempt)/g.test(file)) {
                  try {
                    this.uploadAttachment(resultId, SCREENSHOTS_FOLDER_PATH + '/' + folder + '/' + spec + '/' + file)} catch (err) {
                console.log('Screenshot upload error: ', err)
              }
            }
          });
            })
          })
        })
      })
    });
  };

  public closeRun() {
    this.runId = TestRailCache.retrieve('runId');
    axios({
        method: 'post',
        url: `${this.base}/close_run/${this.runId}`,
        headers: { 'Content-Type': 'application/json' },
        auth: {
          username: this.options.username,
          password: this.options.password,
        },
      })
      .then(() => {
          TestRailLogger.log('Test run closed successfully');
      })
      .catch(error => console.error(error));
  }
}

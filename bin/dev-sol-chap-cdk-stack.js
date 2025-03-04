#!/usr/bin/env node

const cdk = require('aws-cdk-lib');
const { DevSolChapCdkStackStack } = require('../lib/dev-sol-chap-cdk-stack-stack');

const app = new cdk.App();
new DevSolChapCdkStackStack(app, 'DevSolChapCdkStackStack');

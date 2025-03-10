const cdk = require('aws-cdk-lib'); // ✅ Import AWS CDK first
const { Stack, Duration, RemovalPolicy } = require('aws-cdk-lib'); 
const { Runtime, Function, Code } = require('aws-cdk-lib/aws-lambda'); // ✅ Add Runtime and Function
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const sqs = require('aws-cdk-lib/aws-sqs');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const events = require('aws-cdk-lib/aws-events');
const targets = require('aws-cdk-lib/aws-events-targets');
const logs = require('aws-cdk-lib/aws-logs'); // ✅ Import logs
const bcrypt = require('bcryptjs'); // Used to compare hashed passwords
const path = require("path");
const { profile } = require("console");

class DevSolChapCdkStackStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT || "default",
        region: process.env.CDK_DEFAULT_REGION || "ap-southeast-2", 
      },
    });

    // 📌 Reference the existing Users table
    // 📌 Users Table
    const usersTable = new dynamodb.Table(this, 'DevUserTable', {
      tableName: 'Dev-Users',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Prevents accidental deletion
    });

    // ✅ Define the EmailIndex (GSI)
    usersTable.addGlobalSecondaryIndex({
      indexName: 'Dev-EmailIndex', // GSI Name
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING }, // Email field
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING }, // User ID field
      projectionType: dynamodb.ProjectionType.ALL, // Include all attributes
      
    });

    // 📌 Categories Table
    const categoriesTable = new dynamodb.Table(this, 'DevCategoriesTable', {
      tableName: 'Dev-Categories',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    categoriesTable.addGlobalSecondaryIndex({
      indexName: 'Dev-MarketplaceIndex',
      partitionKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 📌 Sections Table
    const sectionsTable = new dynamodb.Table(this, 'DevSectionsTable', {
      tableName: 'Dev-Sections',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 📌 CardSchemas Table
    const cardSchemasTable = new dynamodb.Table(this, 'DevCardSchemasTable', {
      tableName: 'Dev-CardSchemas',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING }, // SCHEMA#{id}
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING }, // SECTION#{sectionId}
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 📌 Listings Table (for verification)
    const listingsTable = new dynamodb.Table(this, 'DevListingsTable', {
      tableName: 'Dev-Listings',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING }, // LISTING#{id}
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING }, // VERIFICATION
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 📌 Messages Table
    const messagesTable = new dynamodb.Table(this, 'DevMessagesTable', {
      tableName: 'Dev-Messages',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING }, // MESSAGE#{id}
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING }, // STATUS
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 📌 Create DynamoDB Table for Bids
    const bidsTable = new dynamodb.Table(this, 'DevBids', {
      tableName: 'Dev-Bids',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING }, // BID#{id}
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING }, // AUCTION#{auctionId}
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 📌 Create DynamoDB Table for Marketplace
    const marketplaceTable = new dynamodb.Table(this, "MarketplaceTable", {
      tableName: "Dev-Marketplace",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Add Global Secondary Index
    marketplaceTable.addGlobalSecondaryIndex({
      indexName: "Dev-StatusIndex",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // 📌 Create DynamoDB Table for Subcategory
    const subcategoriesTable = new dynamodb.Table(this, "SubcategoriesTable", {
      tableName: "Dev-Subcategories",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 📌 Create DynamoDB Table for Cards
    const cardsTable = new dynamodb.Table(this, "CardsTable", {
      tableName: "Dev-Cards",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });


    // 📌 Create DynamoDB Table for Message Filters
    const messageFiltersTable = new dynamodb.Table(this, "MessageFiltersTable", {
      tableName: "Dev-MessageFilters",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // 📌 Create DynamoDB Table for Templates
    const templatesTable = new dynamodb.Table(this, "TemplatesTable", {
      tableName: "Dev-Templates",
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING }, // TEMPLATE#{id}
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING }, // TYPE
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    /**
         * Amazon SQS Queues
         */
    const marketplaceQueue = new sqs.Queue(this, "MarketplaceQueue", {
      queueName: "Dev-MarketplaceQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const marketplaceEventBus = new events.EventBus(this, "MarketplaceEventBus", {
      eventBusName: "Dev-MarketplaceEventBus",
    });

    // ✅ IAM Role for Lambda Functions
    const lambdaExecutionRole = new iam.Role(this, "LambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonDynamoDBFullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSQSFullAccess"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEventBridgeFullAccess"),
      ],
    });


    const subcategoryQueue = new sqs.Queue(this, "SubcategoryQueue", {
      queueName: "Dev-SubcategoryQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const cardQueue = new sqs.Queue(this, "CardQueue", {
      queueName: "Dev-CardQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const uncoverQueue = new sqs.Queue(this, "UncoverQueue", {
      queueName: "Dev-UncoverQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const subjectQueue = new sqs.Queue(this, "SubjectQueue", {
      queueName: "Dev-SubjectQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const profileQueue = new sqs.Queue(this, 'ProfileQueue', {
      queueName: 'Dev-ProfileQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const reviewQueue = new sqs.Queue(this, 'ReviewQueue', {
      queueName: 'Dev-ReviewQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // Create an SQS queue for filtered messages
    const filterQueue = new sqs.Queue(this, 'FilterQueue', {
      queueName: 'Dev-FilterQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // 📌 Create SQS Queues with Visibility Timeout (matching existing format)
    const displayQueue = new sqs.Queue(this, 'DisplayQueue', {
      queueName: 'Dev-DisplayQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const organizeQueue = new sqs.Queue(this, 'OrganizeQueue', {
      queueName: 'Dev-OrganizeQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });


    const messageQueue = new sqs.Queue(this, "MessageQueue", {
      queueName: "Dev-MessageQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const circumventQueue = new sqs.Queue(this, "CircumventQueue", {
      queueName: "Dev-CircumventQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const detailQueue = new sqs.Queue(this, "DetailQueue", {
      queueName: "Dev-DetailQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const templateQueue = new sqs.Queue(this, "TemplateQueue", {
      queueName: "Dev-TemplateQueue",
      visibilityTimeout: cdk.Duration.seconds(30),
    });

     // 📌 Create an SQS Queue for Authentication Processing
     const authQueue = new sqs.Queue(this, 'AuthQueuee', {
      queueName: 'Dev-AuthQueuee',
      visibilityTimeout: cdk.Duration.seconds(30), // Visibility Timeout for message processing
    });


    // Lambda Functions 
    const logoutUserLambda = new lambda.Function(this, "LogoutUserLambda", {
      functionName: "Dev-LogoutUserLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/user/dev-logoutUser"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: usersTable.tableName,
        QUEUE_URL: authQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });
    
    const organizeContentLambda = new lambda.Function(this, "OrganizeContentLambda", {
      functionName: "Dev-OrganizeContentLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/marketplace/dev-organizeContent"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: sectionsTable.tableName,
        QUEUE_URL: organizeQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });
    
    const setDisplayRulesLambda = new lambda.Function(this, "SetDisplayRulesLambda", {
      functionName: "Dev-SetDisplayRulesLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/marketplace/dev-setDisplayRules"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: sectionsTable.tableName,
        QUEUE_URL: displayQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });
    
    const createSubcategoryLambda = new lambda.Function(this, "CreateSubcategoryLambda", {
      functionName: "Dev-CreateSubcategoryLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/marketplace/dev-createSubcategory"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: subcategoriesTable.tableName,
        QUEUE_URL: subcategoryQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });
    
    const createCardLambda = new lambda.Function(this, "CreateCardLambda", {
      functionName: "Dev-CreateCardLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/cards/dev-createCard"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: cardsTable.tableName,
        QUEUE_URL: cardQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });
    
    const reviewListingLambda = new lambda.Function(this, "ReviewListingLambda", {
      functionName: "Dev-ReviewListingLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/cards/dev-reviewListing"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: listingsTable.tableName,
        QUEUE_URL: reviewQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });
    

    const createMessageLambda = new lambda.Function(this, "CreateMessageLambda", {
      functionName: "Dev-CreateMessageLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/messages/dev-createMessage"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: messagesTable.tableName,
        QUEUE_URL: messageQueue.queueUrl,
      },
    });

    const reviewMessageLambda = new lambda.Function(this, "ReviewMessageLambda", {
      functionName: "Dev-ReviewMessageLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/messages/dev-reviewMessage"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: messagesTable.tableName,
        QUEUE_URL: reviewQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });

    const checkCircumventionLambda = new lambda.Function(this, "CheckCircumventionLambda", {
      functionName: "Dev-CheckCircumventionLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/messages/dev-checkCircumvention"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: messagesTable.tableName,
        QUEUE_URL: circumventQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });

    const reviewMessageDetailsLambda = new lambda.Function(this, "ReviewMessageDetailsLambda", {
      functionName: "Dev-ReviewMessageDetailsLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/messages/dev-reviewMessageDetails"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: messagesTable.tableName,
        QUEUE_URL: detailQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });

    const updateTemplateLambda = new lambda.Function(this, "UpdateTemplateLambda", {
      functionName: "Dev-UpdateTemplateLambdaFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset("lambda/notifications/dev-updateTemplate"),
      handler: "index.handler",
      environment: {
        TABLE_NAME: templatesTable.tableName,
        QUEUE_URL: templateQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
    });


    // Lambda Function for Getting User Profile
    const getUserProfile = new lambda.Function(this, "GetUserProfileLambda", {
      functionName: "Dev-GetUserProfileFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/user/dev-getUserProfile'),
      environment: {
        USERS_TABLE: usersTable.tableName,
        profileQueue: profileQueue.queueUrl,
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Lambda Functions
    const deleteMarketplace = new lambda.Function(this, "DeleteMarketplaceLambda", {
      functionName: "Dev-DeleteMarketplaceFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/marketplace/dev-deleteMarketplace'),
      environment: {
        MARKETPLACE_TABLE: marketplaceTable.tableName,
        QUEUE_URL: marketplaceQueue.queueUrl,
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });


    const updateSubcategory = new lambda.Function(this, "UpdateSubcategoryLambda", {
      functionName: "Dev-UpdateSubcategoryFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/marketplace/dev-updateSubcategory'),
      environment: {
        SUBCATEGORIES_TABLE: subcategoriesTable.tableName,
        QUEUE_URL: subcategoryQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    const deleteSubcategory = new lambda.Function(this, "DeleteSubcategoryLambda", {
      functionName: "Dev-DeleteSubcategoryFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/marketplace/dev-deleteSubcategory'),
      environment: {
        SUBCATEGORIES_TABLE: subcategoriesTable.tableName,
        QUEUE_URL: subcategoryQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    const getSubcategoriesByCategory = new lambda.Function(this, "GetSubcategoriesByCategoryLambda", {
      functionName: "Dev-GetSubcategoriesByCategoryFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/marketplace/dev-getSubcategoriesByCategory'),
      environment: {
        SUBCATEGORIES_TABLE: subcategoriesTable.tableName,
        QUEUE_URL: subcategoryQueue.queueUrl,
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });


    const updateCard = new lambda.Function(this, "UpdateCardLambda", {
      functionName: "Dev-UpdateCardFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/cards/dev-updateCard'),
      environment: {
        CARDS_TABLE: cardsTable.tableName,
        QUEUE_URL: cardQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    const reviewCard = new lambda.Function(this, "ReviewCardLambda", {
      functionName: "Dev-ReviewCardFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/cards/dev-reviewCard'),
      environment: {
        CARDS_TABLE: cardsTable.tableName,
        QUEUE_URL: reviewQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    const uncoverCard = new lambda.Function(this, "UncoverCardLambda", {
      functionName: "Dev-UncoverCardFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/cards/dev-uncoverCard'),
      environment: {
        CARDS_TABLE: cardsTable.tableName,
        UNCOVER_QUEUE_URL: uncoverQueue.queueUrl,
        EVENT_BUS_NAME: "default",
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Messages Module Lambda Functions
    const updateMessageFilters = new lambda.Function(this, "UpdateMessageFiltersLambda", {
      functionName: "Dev-UpdateMessageFiltersFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/messages/dev-updateMessageFilters'),
      environment: {
        MESSAGE_FILTERS_TABLE:  messageFiltersTable.tableName,
        QUEUE_URL: filterQueue.queueUrl,
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    const reviewSubject = new lambda.Function(this, "ReviewSubjectLambda", {
      functionName: "Dev-ReviewSubjectFunction",
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset('lambda/messages/dev-reviewSubject'),
      environment: {
        MESSAGES_TABLE: messagesTable.tableName,
        QUEUE_URL: subjectQueue.queueUrl,
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    

      // 📌 SQS Queue for Category Updates
        const categoryQueue = new sqs.Queue(this, 'CategoryQueue', {
          queueName: 'Dev-CategoryQueue',
          visibilityTimeout: cdk.Duration.seconds(30),
        });

    // 🛒 Lambda Functions
    const createCategoryLambda = new lambda.Function(this, 'CreateCategoryFunction', {
      functionName: 'Dev-CreateCategoryFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/marketplace/dev-createCategory'),
      environment: { 
        TABLE_NAME: categoriesTable.tableName,
        QUEUE_URL: categoryQueue.queueUrl,
        EVENT_BUS_NAME: 'Dev-CategoryUpdateEventBus', 
      },
    });

    // 📌 EventBridge Rule for Category Updates
    const categoryUpdateRule = new events.Rule(this, 'CategoryUpdateRule', {
      ruleName: 'Dev-CategoryUpdateRule',
      eventPattern: {
        source: ['aws.marketplace'],
        detailType: ['CategoryUpdate'],
      },
    });
    categoryUpdateRule.addTarget(new targets.SqsQueue(categoryQueue));

    // 📌 Update Category Lambda
    const updateCategoryLambda = new lambda.Function(this, 'UpdateCategoryFunction', {
      functionName: 'Dev-UpdateCategoryFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/marketplace/dev-updateCategory'),
      environment: { 
        TABLE_NAME: categoriesTable.tableName,
        CATEGORY_QUEUE_URL: categoryQueue.queueUrl,
        EVENT_BUS_NAME: 'Dev-CategoryUpdateEventBus',
      },
    }); 

    // 📌 SQS Queue for Delete Category
    const deleteCategoryQueue = new sqs.Queue(this, 'DeleteCategoryQueue', {
      queueName: 'Dev-DeleteCategoryQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // 📌 EventBridge Rule for Delete Category
    const deleteCategoryRule = new events.Rule(this, 'DeleteCategoryRule', {
      ruleName: 'Dev-DeleteCategoryRule',
      eventPattern: {
        source: ['aws.marketplace'],
        detailType: ['CategoryDelete'],
      },
    });
    deleteCategoryRule.addTarget(new targets.SqsQueue(deleteCategoryQueue));

    // 📌 Delete Category Lambda
    const deleteCategoryLambda = new lambda.Function(this, 'DeleteCategoryFunction', {
      functionName: 'Dev-DeleteCategoryFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/marketplace/dev-deleteCategory'),
      environment: {
        TABLE_NAME: categoriesTable.tableName,
        DELETE_CATEGORY_QUEUE_URL: deleteCategoryQueue.queueUrl,
      },
    });

    const getCategoryLambda = new lambda.Function(this, 'GetCategoryFunction', {
      functionName: 'Dev-GetCategoryFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/marketplace/dev-getCategory'),
      environment: { TABLE_NAME: categoriesTable.tableName,
        QUEUE_URL: categoryQueue.queueUrl,
        EVENT_BUS_NAME: 'Dev-CategoryUpdateEventBus',
       },
    });

    // 📌 AssignQueue (SQS for Section Assignments)
    const assignQueue = new sqs.Queue(this, 'AssignQueue', {
      queueName: 'Dev-AssignQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // 📌 AssignEvent (EventBridge Rule for Section Assignments)
    const assignEventRule = new events.Rule(this, 'AssignEventRule', {
      ruleName: 'Dev-AssignEventRule',
      eventPattern: {
        source: ['aws.marketplace'],
        detailType: ['SubcategoryAssignment'],
      },
    });
    assignEventRule.addTarget(new targets.SqsQueue(assignQueue));

    // 📌 Assign Subcategory Lambda
    const assignSubcategoryLambda = new lambda.Function(this, 'AssignSubcategoryFunction', {
      functionName: 'Dev-AssignSubcategoryFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/marketplace/dev-assignSubcategory'),
      environment: { 
        SECTIONS_TABLE: sectionsTable.tableName,
        ASSIGN_QUEUE_URL: assignQueue.queueUrl,
      },
    });

    // 📌 SQS Queue for Schema Imports
    const schemaImportQueue = new sqs.Queue(this, 'SchemaImportQueue', {
      queueName: 'Dev-SchemaImportQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // 📌 EventBridge Rule for Schema Imports
    const schemaImportEventRule = new events.Rule(this, 'SchemaImportEventRule', {
      ruleName: 'Dev-SchemaImportEventRule',
      eventPattern: {
        source: ['aws.marketplace'],
        detailType: ['SchemaImport'],
      },
    });
    schemaImportEventRule.addTarget(new targets.SqsQueue(schemaImportQueue));

    // 📌 Import Card Schema Lambda
    const importCardSchemaLambda = new lambda.Function(this, 'ImportCardSchemaFunction', {
      functionName: 'Dev-ImportCardSchemaFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/cards/dev-importCardSchema'),
      environment: {
        CARDSCHEMAS_TABLE: cardSchemasTable.tableName,
        SCHEMA_IMPORT_QUEUE_URL: schemaImportQueue.queueUrl,
      },
    });

    // 📌 SQS Queue for Verification
    const verifyQueue = new sqs.Queue(this, 'VerifyQueue', {
      queueName: 'Dev-VerifyQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // 📌 EventBridge Rule for Verification
    const verifyQueueRule = new events.Rule(this, 'VerifyQueueRule', {
      ruleName: 'Dev-VerifyQueueRule',
      eventPattern: {
        source: ['aws.marketplace'], // Assuming the source is 'aws.marketplace' for the event.
        detailType: ['VerifyListing'], // Event type when a listing is verified.
      },
    });
    verifyQueueRule.addTarget(new targets.SqsQueue(verifyQueue));

    // 📌 New Lambda for Listings Verification
    const verifyListingLambda = new lambda.Function(this, 'VerifyListingFunction', {
      functionName: 'Dev-VerifyListingFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/listings/dev-verifyListing'),
      environment: {
        LISTINGS_TABLE: listingsTable.tableName,
        VERIFY_QUEUE_URL: verifyQueue.queueUrl,
      },
    });

     

    // Define the Lambda function
    const getPendingMessagesLambda = new lambda.Function(this, 'GetPendingMessagesFunction', {
      functionName: 'Dev-GetPendingMessagesFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/messages/dev-getPendingMessages'),
      environment: {
        MESSAGES_TABLE: messagesTable.tableName,
        REVIEW_QUEUE_URL: reviewQueue.queueUrl, // Pass queue URL to Lambda
      },
    });

    // Create the PostMessage Lambda function
    const postMessageLambda = new lambda.Function(this, 'PostMessageFunction', {
      functionName: 'Dev-PostMessageFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/messages/dev-postMessage'),
      environment: {
        MESSAGES_TABLE: messagesTable.tableName,
      },
    });

    const replyQueue = new sqs.Queue(this, 'ReplyQueue', {
      queueName: 'Dev-ReplyQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    const replyEventRule = new events.Rule(this, 'ReplyEventRule', {
      ruleName: 'Dev-ReplyEventRule',
      eventPattern: {
        source: ['aws.messages'],
        detailType: ['ReplyToMessage'],
      },
    });
    replyEventRule.addTarget(new targets.SqsQueue(replyQueue));
    
    const replyToMessageLambda = new lambda.Function(this, 'ReplyToMessageFunction', {
      functionName: 'Dev-ReplyToMessageFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/messages/dev-replyToMessage'),
      environment: {
        MESSAGE_TABLE: messagesTable.tableName,
        REPLY_QUEUE_URL: replyQueue.queueUrl,
      },
    });  
    
    

    // Create an EventBridge rule for filtering events
    const filterEventRule = new events.Rule(this, 'FilterEventRule', {
      ruleName: 'Dev-FilterEventRule',
      eventPattern: {
        source: ['aws.messages'],
        detailType: ['FilterContactInfo'],
      },
    });
    filterEventRule.addTarget(new targets.SqsQueue(filterQueue));

    // Create the Lambda function for message filtering
    const filterContactInfoLambda = new lambda.Function(this, 'FilterContactInfoFunction', {
      functionName: 'Dev-FilterContactInfoFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/messages/dev-filterContactInfo'),
      environment: {
        MESSAGE_TABLE: messagesTable.tableName,
        FILTER_QUEUE_URL: filterQueue.queueUrl,
      },
    });

     // 📌 Create an SQS Queue for Bid Processing
     const bidQueue = new sqs.Queue(this, 'BidQueue', {
      queueName: 'Dev-BidQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // 📌 Create an EventBridge Rule for Bid Events
    const bidEventRule = new events.Rule(this, 'BidEventRule', {
      ruleName: 'Dev-BidEvent',
      eventPattern: {
        source: ['aws.auctions'],
        detailType: ['PlaceBid'],
      },
    });
    bidEventRule.addTarget(new targets.SqsQueue(bidQueue));

    // 📌 Create the Lambda Function for Placing Bids
    const placeBidLambda = new lambda.Function(this, 'PlaceBidFunction', {
      functionName: 'Dev-PlaceBidFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/auctions/dev-placeBid'),
      environment: {
        BIDS_TABLE: bidsTable.tableName,
        BID_QUEUE_URL: bidQueue.queueUrl,
      },
    });

    // 📌 Create an SQS Queue for Membership Processing
    const membershipQueue = new sqs.Queue(this, 'MembershipQueue', {
      queueName: 'Dev-MembershipQueue',
      visibilityTimeout: cdk.Duration.seconds(30),
    });

    // 📌 Create an EventBridge Rule for Membership Events
    const membershipEventRule = new events.Rule(this, 'MembershipEventRule', {
      ruleName: 'Dev-MembershipEvent',
      eventPattern: {
        source: ['aws.membership'],
        detailType: ['UpgradeMembership'],
      },
    });
    membershipEventRule.addTarget(new targets.SqsQueue(membershipQueue));

    // 📌 Create the Lambda Function for Upgrading Membership
    const upgradeMembershipLambda = new lambda.Function(this, 'UpgradeMembershipFunction', {
      functionName: 'Dev-UpgradeMembershipFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/membership/dev-upgradeMembership'),
      environment: {
        USERS_TABLE: usersTable.tableName,
        MEMBERSHIP_QUEUE_URL: membershipQueue.queueUrl,
      },
    });

   

    // 📌 Create an EventBridge Rule for Authentication Events
    const loginEventRule = new events.Rule(this, 'LoginEventRule', {
      ruleName: 'Dev-LoginEvent', // Name of the rule
      eventPattern: {
        source: ['aws.auth'], // The source for the event
        detailType: ['LoginEvent'], // The event detail type for login event
      },
    });

    // 📌 Add the SQS Queue as the Target for the EventBridge Rule
    loginEventRule.addTarget(new targets.SqsQueue(authQueue));






    // 📌 Create the Lambda Function for Handling User Authentication
    const loginUserLambda = new lambda.Function(this, 'LoginUserFunction', {
      functionName: 'Dev-LoginUserFunction',
      runtime: lambda.Runtime.NODEJS_18_X, // Set the Lambda runtime to Node.js 18.x
      handler: 'index.handler', // The entry point for the Lambda function
      code: lambda.Code.fromAsset('lambda/user/dev-loginUser'), // The Lambda function code location
      environment: {
        USERS_TABLE: usersTable.tableName, // Set the USERS_TABLE environment variable for database access
        AUTH_QUEUE_URL: authQueue.queueUrl, // Set the AUTH_QUEUE_URL environment variable for the SQS queue URL
      },
    });

        // 📌 Create an SQS Queue for User Deletion Processing
    const userQueue = new sqs.Queue(this, 'UserQueue', {
      queueName: 'Dev-UserQueue',
      visibilityTimeout: cdk.Duration.seconds(30), // Visibility Timeout for message processing
    });

    // 📌 Create an EventBridge Rule for User Deletion Events
    const userDeleteEventRule = new events.Rule(this, 'UserDeleteEventRule', {
      ruleName: 'Dev-UserDeleteEvent', // Name of the rule
      eventPattern: {
        source: ['aws.users'], // The source for the event
        detailType: ['UserDeleteEvent'], // The event detail type for user deletion
      },
    });

    // 📌 Add the SQS Queue as the Target for the EventBridge Rule
    userDeleteEventRule.addTarget(new targets.SqsQueue(userQueue));

    // 📌 Create the Lambda Function for Handling User Deletion
    const deleteUserLambda = new lambda.Function(this, 'DeleteUserFunction', {
      functionName: 'Dev-DeleteUserFunction',
      runtime: lambda.Runtime.NODEJS_18_X, // Set the Lambda runtime to Node.js 18.x
      handler: 'index.handler', // The entry point for the Lambda function
      code: lambda.Code.fromAsset('lambda/user/dev-deleteUser'), // The Lambda function code location
      environment: {
        USERS_TABLE: usersTable.tableName, // Set the USERS_TABLE environment variable for database access
        USER_QUEUE_URL: userQueue.queueUrl, // Set the USER_QUEUE_URL environment variable for the SQS queue URL
      },
    });

    // 📌 Create an EventBridge Rule for User Registration Events
    const userCreateEventRule = new events.Rule(this, 'UserCreateEventRule', {
      ruleName: 'Dev-UserCreateEvent',
      eventPattern: {
        source: ['aws.users'],
        detailType: ['UserCreateEvent'],
      },
    });

    // 📌 Add the SQS Queue as the Target for the EventBridge Rule
    userCreateEventRule.addTarget(new targets.SqsQueue(userQueue));

    // 📌 Create the Lambda Function for Handling User Registration
    const registerUserLambda = new lambda.Function(this, 'RegisterUserFunction', {
      functionName: 'Dev-RegisterUserFunction',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/user/dev-registerUser'),
      environment: {
        USERS_TABLE: usersTable.tableName,
        USER_QUEUE_URL: userQueue.queueUrl,
      },
    });


     /**
     * ✅ Create Marketplace Lambda Function
     */
     const createMarketplaceLambda = new Function(this, "CreateMarketplaceLambda", {
      functionName: 'Dev-CreateMarketplaceFunction',
      runtime: Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: Code.fromAsset("lambda/marketplace/dev-createMarketplace"),
      environment: {
        MARKETPLACE_TABLE: marketplaceTable.tableName,
        MARKETPLACE_QUEUE_URL: marketplaceQueue.queueUrl,
        EVENT_BUS_NAME: marketplaceEventBus.eventBusArn,
      },
      role: lambdaExecutionRole,
    });

    /**
     * ✅ Update Marketplace Lambda Function
     */
    const updateMarketplaceLambda = new Function(this, "UpdateMarketplaceLambda", {
      functionName: 'Dev-UpdateMarketplaceFunction',
      runtime: Runtime.NODEJS_18_X,
      handler: "index.handler",
      code: Code.fromAsset("lambda/marketplace/dev-updateMarketplace"),
      environment: {
        MARKETPLACE_TABLE: marketplaceTable.tableName,
        MARKETPLACE_QUEUE_URL: marketplaceQueue.queueUrl,
        EVENT_BUS_NAME: marketplaceEventBus.eventBusArn,
      },
      role: lambdaExecutionRole,
    });


  
    

  



    /**
         *  Grant IAM Permissions for ALL Functions
         */
    const allLambdas = [
      createMarketplaceLambda,
      updateMarketplaceLambda,
      deleteMarketplace,
      createCategoryLambda,
      updateCategoryLambda,
      deleteCategoryLambda,
      assignSubcategoryLambda,
      importCardSchemaLambda,
      verifyListingLambda,
      postMessageLambda,
      replyToMessageLambda,
      filterContactInfoLambda,
      placeBidLambda,
      upgradeMembershipLambda,
      loginUserLambda,
      registerUserLambda,
      updateSubcategory,
      updateCard,
      updateTemplateLambda,
      organizeContentLambda,
      setDisplayRulesLambda,
      createSubcategoryLambda,
      createCardLambda,
      reviewListingLambda,
      createMessageLambda,
      reviewMessageLambda,
      checkCircumventionLambda,
      reviewMessageDetailsLambda,
      deleteUserLambda,
      uncoverCard,
      deleteSubcategory
    ];
    

  // Allow all Lambda functions to read/write data from their respective DynamoDB tables

  usersTable.grantReadData(getUserProfile);
  marketplaceTable.grantWriteData(deleteMarketplace);
  marketplaceTable.grantReadWriteData(createMarketplaceLambda);
  createMarketplaceLambda.addToRolePolicy(new iam.PolicyStatement({
    actions: ["dynamodb:PutItem"],
    resources: [marketplaceTable.tableArn],
}));


  marketplaceTable.grantReadWriteData(updateMarketplaceLambda);
  // Grant permission for DeleteMarketplaceLambda to perform GetItem on the Marketplace table
  marketplaceTable.grantReadData(deleteMarketplace);

  // Grant permissions to Marketplace Queue
  marketplaceQueue.grantSendMessages(createMarketplaceLambda);
  createMarketplaceLambda.addToRolePolicy(new iam.PolicyStatement({
    actions: ["sqs:SendMessage"],
    resources: [marketplaceQueue.queueArn],
}));

  marketplaceQueue.grantSendMessages(updateMarketplaceLambda);
  marketplaceQueue.grantSendMessages(deleteMarketplace);

  // Grant permissions to EventBridge
  marketplaceEventBus.grantPutEventsTo(createMarketplaceLambda);
  marketplaceEventBus.grantPutEventsTo(updateMarketplaceLambda);
  marketplaceEventBus.grantPutEventsTo(deleteMarketplace);

  

  subcategoriesTable.grantReadWriteData(updateSubcategory);
  subcategoriesTable.grantReadWriteData(deleteSubcategory);
  subcategoriesTable.grantReadData(getSubcategoriesByCategory);
  subcategoriesTable.grantWriteData(createSubcategoryLambda);
  subcategoryQueue.grantSendMessages(createSubcategoryLambda);
  
  cardsTable.grantReadWriteData(updateCard);
  cardsTable.grantWriteData(reviewCard);
  cardsTable.grantWriteData(createCardLambda);
    cardQueue.grantSendMessages(createCardLambda);

  

  messageFiltersTable.grantReadWriteData(updateMessageFilters);
  messagesTable.grantReadWriteData(reviewSubject);
  cardsTable.grantReadWriteData(uncoverCard);
  uncoverQueue.grantSendMessages(uncoverCard);


  // ✅ Allow all Lambda functions to send messages to all SQS queues
  allLambdas.forEach(lambdaFn => {
    lambdaFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["sqs:SendMessage"],
      resources: [
        categoryQueue.queueArn,
        cardQueue.queueArn,
        reviewQueue.queueArn,
        uncoverQueue.queueArn,
        filterQueue.queueArn,
        subjectQueue.queueArn,
        subcategoryQueue.queueArn,
        marketplaceQueue.queueArn,
        profileQueue.queueArn,
        assignQueue.queueArn,       // 📌 Added: Assign Queue (Subcategory Assignment)
        schemaImportQueue.queueArn, // 📌 Added: Schema Import Queue (CardSchemas)
        verifyQueue.queueArn,       // 📌 Added: Verify Queue (Listings Verification)
        replyQueue.queueArn,        // 📌 Added: Reply Queue (Messaging)
        detailQueue.queueArn,       // 📌 Added: Message Details Queue
        circumventQueue.queueArn,   // 📌 Added: Circumvention Queue (Messaging)
        templateQueue.queueArn,     // 📌 Added: Template Queue (Notifications)
        membershipQueue.queueArn,   // 📌 Added: Membership Queue (Upgrades)
        bidQueue.queueArn,          // 📌 Added: Bid Queue (Auction Bids)
        authQueue.queueArn,         // 📌 Added: Authentication Queue (Login/Logout)
        userQueue.queueArn,         // 📌 Added: User Queue (Registration/Deletion)
        deleteCategoryQueue.queueArn // 📌 Added: Delete Category Queue
      ]
    }));
  });

 // ✅ Allow all Lambda functions to publish events to ALL EventBridge buses
  allLambdas.forEach(lambdaFn => {
    lambdaFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["events:PutEvents"],
        resources: [
            `arn:aws:events:${this.region}:${this.account}:event-bus/default`, // Default Event Bus
            marketplaceEventBus.eventBusArn, // 📌 Added: Marketplace Events
            `arn:aws:events:${this.region}:${this.account}:event-bus/Dev-CategoryUpdateEventBus`, // 📌 Added: Category Events
            `arn:aws:events:${this.region}:${this.account}:event-bus/Dev-UserEventBus`, // 📌 Added: User Authentication & Deletion Events
            `arn:aws:events:${this.region}:${this.account}:event-bus/Dev-MembershipEventBus`, // 📌 Added: Membership Upgrade Events
            `arn:aws:events:${this.region}:${this.account}:event-bus/Dev-BidEventBus` // 📌 Added: Bidding Events
        ]
    }));
  });

  //  Allow all Lambda functions to invoke other Lambda functions if needed
  allLambdas.forEach(lambdaFn => {
      lambdaFn.addToRolePolicy(new iam.PolicyStatement({
          actions: ["lambda:InvokeFunction"],
          resources: ["*"]
      }));
  });
  
  // Explicitly allow getSubcategoriesByCategory to read from the GSI
  getSubcategoriesByCategory.addToRolePolicy(new iam.PolicyStatement({
  actions: ["dynamodb:Query"],
   resources: [`${subcategoriesTable.tableArn}/index/SK-PK-index`], // Allow querying the GSI
  }));

  // Create the EventBridge Rule for Profile Read Event
  const profileReadRule = new events.Rule(this, "ProfileReadEvent", {
   ruleName: "Dev-ProfileReadEvent",
   eventPattern: {
   source: ["custom.user.profile"],
   detailType: ["Profile Read"],
   },
  });

  // Add Lambda Function as Target
  profileReadRule.addTarget(new targets.LambdaFunction(getUserProfile));

  


    // 📌 Grant permissions
    categoriesTable.grantReadWriteData(createCategoryLambda);
    categoriesTable.grantReadWriteData(updateCategoryLambda);
    categoryQueue.grantSendMessages(updateCategoryLambda);
    updateCategoryLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));
    // 📌 Grant permissions
    categoriesTable.grantReadWriteData(deleteCategoryLambda);
    deleteCategoryQueue.grantSendMessages(deleteCategoryLambda);
    deleteCategoryLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));

    categoriesTable.grantReadData(getCategoryLambda);

    organizeQueue.grantSendMessages(organizeContentLambda);
    displayQueue.grantSendMessages(setDisplayRulesLambda);

    sectionsTable.grantWriteData(organizeContentLambda);
    sectionsTable.grantWriteData(setDisplayRulesLambda);
    sectionsTable.grantReadWriteData(assignSubcategoryLambda);


    assignQueue.grantSendMessages(assignSubcategoryLambda);
    assignSubcategoryLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));
    
    cardSchemasTable.grantReadWriteData(importCardSchemaLambda);
    schemaImportQueue.grantSendMessages(importCardSchemaLambda);
    importCardSchemaLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));

    // Grant necessary permissions to the Lambda function
    listingsTable.grantReadWriteData(verifyListingLambda);
    listingsTable.grantWriteData(reviewListingLambda);


    verifyQueue.grantSendMessages(verifyListingLambda);
    verifyListingLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'], // Grant permission to publish events to EventBridge
      resources: ['*'], // You can limit to a specific EventBridge bus or pattern if needed
    }));


    circumventQueue.grantSendMessages(checkCircumventionLambda);

    detailQueue.grantSendMessages(reviewMessageDetailsLambda);
    templatesTable.grantWriteData(updateTemplateLambda);
    templateQueue.grantSendMessages(updateTemplateLambda);

    // Grant necessary permissions
    messagesTable.grantReadData(getPendingMessagesLambda);
    reviewQueue.grantSendMessages(getPendingMessagesLambda);
    reviewQueue.grantSendMessages(reviewListingLambda);
    messagesTable.grantWriteData(createMessageLambda);
    messageQueue.grantSendMessages(createMessageLambda);
    messagesTable.grantWriteData(reviewMessageLambda);
    reviewQueue.grantSendMessages(reviewMessageLambda);
    messagesTable.grantWriteData(checkCircumventionLambda);
    messagesTable.grantWriteData(reviewMessageDetailsLambda);
    reviewQueue.grantSendMessages(reviewCard);

    // Grant permissions for the Lambda to write to DynamoDB
    messagesTable.grantWriteData(postMessageLambda);

    messagesTable.grantReadWriteData(replyToMessageLambda);
    replyQueue.grantSendMessages(replyToMessageLambda);
    replyToMessageLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));

    // Grant permissions
    messagesTable.grantReadWriteData(filterContactInfoLambda);
    filterQueue.grantSendMessages(filterContactInfoLambda);
    filterContactInfoLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));

    // 📌 Grant Permissions
    bidsTable.grantReadWriteData(placeBidLambda);
    bidQueue.grantSendMessages(placeBidLambda);
    placeBidLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));

    // 📌 Grant Permissions
    usersTable.grantReadWriteData(upgradeMembershipLambda);
    membershipQueue.grantSendMessages(upgradeMembershipLambda);
    upgradeMembershipLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: ['*'],
    }));

    // 📌 Grant Permissions for LoginUser Lambda
    usersTable.grantReadWriteData(loginUserLambda); // Grant read/write access to the USERS_TABLE (DynamoDB)
    usersTable.grantWriteData(logoutUserLambda);
    authQueue.grantSendMessages(loginUserLambda); // Grant permission to send messages to the AuthQueue (SQS)
    authQueue.grantSendMessages(logoutUserLambda);

    loginUserLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'], // Permission to put events in EventBridge
      resources: ['*'], // Allows the Lambda to put events to any EventBridge event bus
    }));

    // ✅ Grant Query Access to EmailIndex
    loginUserLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [
        usersTable.tableArn, // Main Users table
        `${usersTable.tableArn}/index/Dev-EmailIndex`, // EmailIndex GSI
      ],
    }));

    // 📌 Grant Permissions for DeleteUser Lambda
    usersTable.grantReadWriteData(deleteUserLambda); // Grant read/write access to the USERS_TABLE (DynamoDB)
    userQueue.grantSendMessages(deleteUserLambda); // Grant permission to send messages to the UserQueue (SQS)

    deleteUserLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'], // Permission to put events in EventBridge
      resources: ['*'], // Allows the Lambda to put events to any EventBridge event bus
    }));

    // 📌 Grant Permissions for RegisterUser Lambda
    usersTable.grantReadWriteData(registerUserLambda); // Read/write access to DynamoDB Users table
    userQueue.grantSendMessages(registerUserLambda); // Permission to send messages to SQS

    registerUserLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'], // Allow putting events in EventBridge
      resources: ['*'],
    }));

    reviewCard.addToRolePolicy(new iam.PolicyStatement({
      actions: ["events:PutEvents"],
      resources: ["arn:aws:events:ap-southeast-2:066926217034:event-bus/default"], // Allow EventBridge access
   }));
   

    // Define the ARNs for encryption and decryption Lambdas
    const encryptionLambdaArn = `arn:aws:lambda:${this.region}:${this.account}:function:sol-chap-encryption`;
    const decryptionLambdaArn = `arn:aws:lambda:${this.region}:${this.account}:function:sol-chap-decryption`; 

    // 📌 List of Lambda functions for POST and PUT methods (Encryption + Decryption)
    const postAndPutMethods = [
      createMarketplaceLambda,
      updateMarketplaceLambda, // PUT method
      createCategoryLambda,
      updateCategoryLambda, // PUT method
      deleteCategoryLambda,
      assignSubcategoryLambda,
      importCardSchemaLambda,
      verifyListingLambda,
      postMessageLambda,
      replyToMessageLambda,
      filterContactInfoLambda,
      placeBidLambda,
      upgradeMembershipLambda,
      loginUserLambda,
      registerUserLambda,
      updateSubcategory, // PUT method
      updateCard, // PUT method
      updateTemplateLambda, // PUT method
      organizeContentLambda, // PUT method
      setDisplayRulesLambda, // PUT method
      createSubcategoryLambda,
      createCardLambda,
      reviewListingLambda,
      createMessageLambda,
      reviewMessageLambda,
      checkCircumventionLambda,
      reviewMessageDetailsLambda,
      reviewCard,
      uncoverCard,
      deleteSubcategory,
      getSubcategoriesByCategory
    ];

    const getMethods = [
      getCategoryLambda,
      getPendingMessagesLambda,
      getUserProfile,
      getSubcategoriesByCategory
    ];

    // 📌 Grant permission to invoke **only decryption Lambda** for GET methods
    getMethods.forEach(lambdaFn => {
      lambdaFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [decryptionLambdaArn],
      }));
    });

    // 📌 Grant permission to invoke **both encryption and decryption Lambdas** for POST and PUT methods
    postAndPutMethods.forEach(lambdaFn => {
      lambdaFn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["lambda:InvokeFunction"],
        resources: [encryptionLambdaArn, decryptionLambdaArn],
      }));
    });


  // 📌 API Gateway Setup
  const api = new apigateway.RestApi(this, 'MarketplaceApi', {
    restApiName: 'Marketplace Service',
    deployOptions: {
      stageName: 'prod',
      loggingLevel: apigateway.MethodLoggingLevel.INFO,
      tracingEnabled: true,
      accessLogDestination: new apigateway.LogGroupLogDestination(
        new logs.LogGroup(this, 'ApiGatewayAccessLogs', {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        })
      ),
      accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
    },
  });



// 📌 Admin Routes
const adminResource = api.root.addResource('admin');







// 📌 Notifications & Templates
const notificationsResource = adminResource.addResource("notifications");
const templateResource = notificationsResource.addResource("templates");



// 📌 User Profile Resource (from old code)
const usersResource = adminResource.addResource('users');
const userIdResource = usersResource.addResource('{id}');
userIdResource.addMethod('GET', new apigateway.LambdaIntegration(getUserProfile));

// 📌 Marketplace Resource (from old code)
const marketplaceResource = adminResource.addResource('marketplace');
// ✅ Allow OPTIONS request for CORS preflight
marketplaceResource.addMethod('OPTIONS', new apigateway.MockIntegration({
  integrationResponses: [{
      statusCode: '200',
      responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': "'*'",
          'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,POST,PUT,DELETE'",
          'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
      },
  }],
  passthroughBehavior: apigateway.PassthroughBehavior.WHEN_NO_MATCH,
  requestTemplates: {
      "application/json": "{\"statusCode\": 200}"
  }
}), {
  methodResponses: [{
      statusCode: '200',
      responseParameters: {
          'method.response.header.Access-Control-Allow-Origin': true,
          'method.response.header.Access-Control-Allow-Methods': true,
          'method.response.header.Access-Control-Allow-Headers': true,
      },
  }]
});


marketplaceResource.addMethod("POST", new apigateway.LambdaIntegration(createMarketplaceLambda));
const marketplaceWithId = marketplaceResource.addResource('{id}'); 
marketplaceWithId.addMethod("PUT", new apigateway.LambdaIntegration(updateMarketplaceLambda));
marketplaceWithId.addMethod('DELETE', new apigateway.LambdaIntegration(deleteMarketplace));


/**
     * ✅ EventBridge Rule for Marketplace Events
     */
      new events.Rule(this, "MarketplaceCreateEventRule", {
        eventBus: marketplaceEventBus,
        eventPattern: {
          source: ["marketplace.system"],
          detailType: ["MarketplaceCreateEvent"],
        },
        targets: [new targets.LambdaFunction(createMarketplaceLambda)],
      });

// 📌 Categories Routes (combined from old and new code)
const categoriesResource = adminResource.addResource('categories');
categoriesResource.addMethod('POST', new apigateway.LambdaIntegration(createCategoryLambda));

const categoryResource = categoriesResource.addResource('{id}');
categoryResource.addMethod('PUT', new apigateway.LambdaIntegration(updateCategoryLambda));
categoryResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteCategoryLambda));

categoriesResource.addMethod('GET', new apigateway.LambdaIntegration(getCategoryLambda));

// 📌 Subcategories Resource (from old code)
const subcategoryResource = adminResource.addResource('subcategories');
const subcategoryIdResource = subcategoryResource.addResource('{id}');
subcategoryIdResource.addMethod('PUT', new apigateway.LambdaIntegration(updateSubcategory));
subcategoryIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(deleteSubcategory));

const categoryResourceForSubcategories = subcategoryResource.addResource('category');
categoryResourceForSubcategories.addResource('{id}').addMethod('GET', new apigateway.LambdaIntegration(getSubcategoriesByCategory));

// 📌 Cards Resource (from old code)
const cardsResource = adminResource.addResource('cards');
const cardIdResource = cardsResource.addResource('{id}');
cardIdResource.addMethod('PUT', new apigateway.LambdaIntegration(updateCard));
cardIdResource.addResource('uncover').addMethod('POST', new apigateway.LambdaIntegration(uncoverCard));
cardsResource.addResource('review').addMethod('POST', new apigateway.LambdaIntegration(reviewCard));

// 📌 Sections Routes (from new code)
const sectionsResource = adminResource.addResource('sections').addResource('assign');
sectionsResource.addMethod('POST', new apigateway.LambdaIntegration(assignSubcategoryLambda));
const organizeResource = sectionsResource.addResource("organize");
const displayResource = sectionsResource.addResource("display");

// 📌 CardSchemas Routes (from new code)
const cardSchemasResource = adminResource.addResource('cardschemas').addResource('csv');
cardSchemasResource.addMethod('POST', new apigateway.LambdaIntegration(importCardSchemaLambda));

// 📌 Listings Verification Endpoint (from new code)
const listingsResource = adminResource.addResource('listings').addResource('verify');
listingsResource.addMethod('POST', new apigateway.LambdaIntegration(verifyListingLambda));
// 📌 Listings & Reviews
const reviewResource = listingsResource.addResource("review");

// 📌 Messages Routes (combined from old and new code)
// 📌 Ensure the 'messages' resource exists under 'admin'
let messagesResource = adminResource.getResource('messages');
if (!messagesResource) {
  messagesResource = adminResource.addResource('messages');
}

// 📌 Messages
const messageIdResource = messagesResource.addResource("{id}");
const reviewMessageResource = messagesResource.addResource("review");
const messageCircumventionResource = messagesResource.addResource("circumvention");
const messageDetailsResource = messagesResource.addResource("details");

// 📌 Add sub-resources under 'messages'
messagesResource.addResource('filter').addMethod('POST', new apigateway.LambdaIntegration(updateMessageFilters));
messagesResource.addResource('subject').addMethod('POST', new apigateway.LambdaIntegration(reviewSubject));

// 📌 Ensure 'pending' messages route under 'messages'
let pendingMessagesResource = messagesResource.getResource('pending');
if (!pendingMessagesResource) {
  pendingMessagesResource = messagesResource.addResource('pending');
}
pendingMessagesResource.addMethod('GET', new apigateway.LambdaIntegration(getPendingMessagesLambda));

// 📌 Ensure 'postMessagesResource' is added at the root level if not present
let postMessagesResource = api.root.getResource('messages');
if (!postMessagesResource) {
  postMessagesResource = api.root.addResource('messages');
}
postMessagesResource.addMethod('POST', new apigateway.LambdaIntegration(postMessageLambda));

// 📌 Ensure 'reply' is added under 'messages/{id}'
let replyMessagesResource = messagesResource.getResource('{id}');
if (!replyMessagesResource) {
  replyMessagesResource = messagesResource.addResource('{id}');
}
let replyResource = replyMessagesResource.getResource('reply');
if (!replyResource) {
  replyResource = replyMessagesResource.addResource('reply');
}
replyResource.addMethod('POST', new apigateway.LambdaIntegration(replyToMessageLambda));

// 📌 Ensure 'contact-filter' is added under 'messages'
let contactFilterResource = messagesResource.getResource('contact-filter');
if (!contactFilterResource) {
  contactFilterResource = messagesResource.addResource('contact-filter');
}
contactFilterResource.addMethod('POST', new apigateway.LambdaIntegration(filterContactInfoLambda));


// 📌 Auctions Resource (from new code)
const auctionsResource = api.root.addResource('auctions');
const auctionItem = auctionsResource.addResource('{id}').addResource('bid');
auctionItem.addMethod('POST', new apigateway.LambdaIntegration(placeBidLambda));

// 📌 Membership Resource (from new code)
const membershipResource = api.root.addResource('membership').addResource('upgrade');
membershipResource.addMethod('POST', new apigateway.LambdaIntegration(upgradeMembershipLambda));

// 📌 Users Resource (from new code)
const users = api.root.addResource('users');
users.addResource('{id}').addMethod('DELETE', new apigateway.LambdaIntegration(deleteUserLambda), {
  requestParameters: { 'method.request.path.id': true },
});

// 📌 Auth Resource (from new code)
const auth = api.root.addResource('auth');
auth.addResource('login').addMethod('POST', new apigateway.LambdaIntegration(loginUserLambda));
auth.addResource('register').addMethod('POST', new apigateway.LambdaIntegration(registerUserLambda));
auth.addResource('logout').addMethod('POST', new apigateway.LambdaIntegration(logoutUserLambda)); // ✅ Add logout here

// 📌 Integrate Lambda Functions with API Gateway
const logoutIntegration = new apigateway.LambdaIntegration(logoutUserLambda);
const organizeIntegration = new apigateway.LambdaIntegration(organizeContentLambda);
const displayIntegration = new apigateway.LambdaIntegration(setDisplayRulesLambda);
const subcategoryIntegration = new apigateway.LambdaIntegration(createSubcategoryLambda);
const createCardIntegration = new apigateway.LambdaIntegration(createCardLambda);
const reviewListingIntegration = new apigateway.LambdaIntegration(reviewListingLambda);
const createMessageIntegration = new apigateway.LambdaIntegration(createMessageLambda);
const reviewMessageIntegration = new apigateway.LambdaIntegration(reviewMessageLambda);
const checkCircumventionIntegration = new apigateway.LambdaIntegration(checkCircumventionLambda);
const reviewMessageDetailsIntegration = new apigateway.LambdaIntegration(reviewMessageDetailsLambda);
const updateTemplateIntegration = new apigateway.LambdaIntegration(updateTemplateLambda);

// 📌 Add Methods to API Gateway
organizeResource.addMethod("POST", organizeIntegration);
displayResource.addMethod("POST", displayIntegration);
subcategoryResource.addMethod("POST", subcategoryIntegration);
cardsResource.addMethod("POST", createCardIntegration);
reviewResource.addMethod("POST", reviewListingIntegration);
messagesResource.addMethod("POST", createMessageIntegration);
reviewMessageResource.addMethod("POST", reviewMessageIntegration);
messageCircumventionResource.addMethod("POST", checkCircumventionIntegration);
messageDetailsResource.addMethod("POST", reviewMessageDetailsIntegration);
templateResource.addMethod("POST", updateTemplateIntegration);

}
}

module.exports = { DevSolChapCdkStackStack }
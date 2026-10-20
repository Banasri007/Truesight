# AWS setup

Every AWS integration is optional and can be switched on separately. Replace `us-east-1`, the names and the account id with your own. The commands use the AWS CLI v2.

## 1. Amazon Bedrock (Claude perception)

Enable access to the Anthropic Claude model in the Bedrock console (Model access) for your region, then:

```bash
VISION_PROVIDER=bedrock
AWS_REGION=us-east-1
BEDROCK_MODEL=anthropic.claude-opus-5-5
```

## 2. AWS KMS (signing key)

```bash
aws kms create-key --key-spec ECC_NIST_P256 --key-usage SIGN_VERIFY --description "TrueSight ledger signer"
aws kms create-alias --alias-name alias/truesight-signer --target-key-id <KeyId from the output>
```

```bash
SIGNER=kms
KMS_KEY_ID=alias/truesight-signer
```

A ledger is bound to one key. When you switch from `local` to `kms`, also switch to a fresh `DATA_DIR` or DynamoDB table. The server refuses to start otherwise.

## 3. Amazon DynamoDB (ledger)

```bash
aws dynamodb create-table --table-name truesight-ledger \
  --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=seq,AttributeType=N \
  --key-schema AttributeName=pk,KeyType=HASH AttributeName=seq,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
```

```bash
LEDGER_STORE=dynamodb
DYNAMODB_LEDGER_TABLE=truesight-ledger
```

## 4. Amazon S3 with Object Lock (evidence)

```bash
aws s3api create-bucket --bucket truesight-evidence-<unique> --object-lock-enabled-for-bucket
aws s3api put-public-access-block --bucket truesight-evidence-<unique> \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

(Outside `us-east-1`, also pass `--create-bucket-configuration LocationConstraint=<region>`.)

```bash
BLOB_STORE=s3
S3_EVIDENCE_BUCKET=truesight-evidence-<unique>
S3_OBJECT_LOCK_MODE=GOVERNANCE   # or COMPLIANCE
EVIDENCE_RETENTION_DAYS=30
```

Objects are locked until their retention date. Add an S3 lifecycle rule to expire them afterwards.

## 5. Amazon Rekognition (face locations for pixelation)

```bash
FACE_DETECTOR=rekognition
```

TrueSight calls only `DetectFaces` and uses only the bounding boxes. It never calls face search or collection APIs.

## 6. Amazon SNS (alert SMS / email)

```bash
aws sns create-topic --name truesight-alerts
aws sns subscribe --topic-arn <TopicArn> --protocol email --notification-endpoint you@example.com
```

```bash
SNS_TOPIC_ARN=<TopicArn>
```

## IAM policy for the server

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["kms:Sign", "kms:GetPublicKey"], "Resource": "arn:aws:kms:us-east-1:<account>:key/<key-id>" },
    { "Effect": "Allow", "Action": ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query"], "Resource": "arn:aws:dynamodb:us-east-1:<account>:table/truesight-ledger" },
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:PutObjectRetention"], "Resource": "arn:aws:s3:::truesight-evidence-<unique>/*" },
    { "Effect": "Allow", "Action": ["rekognition:DetectFaces"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["sns:Publish"], "Resource": "<TopicArn>" }
  ]
}
```

TrueSight calls Claude through Bedrock's Messages-API (Mantle) endpoint via `@anthropic-ai/bedrock-sdk`. If requests are denied, check the Bedrock documentation for the IAM actions that endpoint requires in your region and add them to the first statement. Narrow `Resource` to the model ARN before production.

import {
  SageMakerClient,
  CreatePipelineCommand,
  StartPipelineExecutionCommand,
} from "@aws-sdk/client-sagemaker"

// Initialize SageMaker client outside handler for connection reuse
const sagemakerClient = new SageMakerClient({
  region: process.env.AWS_REGION || "ap-southeast-2",
})

interface LambdaEvent {
  broadcastId: string
  channel: string
  region: string
  downloadInstanceType?: string
  inferenceInstanceType?: string
}

export const handler = async (event: LambdaEvent) => {
  try {
    const {
      broadcastId,
      channel,
      region,
      downloadInstanceType = "ml.t3.large",
      inferenceInstanceType = "ml.g5.xlarge",
    } = event

    // Build steps array dynamically
    const steps: object[] = [
      {
        Name: `download-${channel}-${region}`,
        Type: "Training",
        Arguments: {
          AlgorithmSpecification: {
            TrainingImage:
              "763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/pytorch-training:2.0.0-gpu-py310",
            TrainingInputMode: "File",
          },
          RoleArn: process.env.ROLE_ARN!,
          OutputDataConfig: {
            S3OutputPath: `s3://${process.env.S3_BUCKET}/pipeline-downloads/${broadcastId}/`,
          },
          ResourceConfig: {
            InstanceType: downloadInstanceType,
            InstanceCount: 1,
            VolumeSizeInGB: 100,
          },
          StoppingCondition: {
            MaxRuntimeInSeconds: 10 * 3600,
          },
          HyperParameters: {
            sagemaker_program: "main.py",
            sagemaker_submit_directory: `s3://${process.env.S3_BUCKET}/download-script/sourcedir.tar.gz`,
          },
          Environment: {
            BROADCAST_ID: broadcastId,
            CHANNEL: channel.toLowerCase(),
            STREAM_REGION: region.toLowerCase(),
            DB_CONNECTION_STRING: process.env.DATABASE_URL!,
            AWS_REGION: process.env.AWS_REGION || "ap-southeast-2",
          },
        },
      },
    ]

    steps.push({
      Name: `integration-analysis-${channel}`,
      Type: "Training",
      DependsOn: [`download-${channel}-${region}`],
      Arguments: {
        AlgorithmSpecification: {
          TrainingImage:
            "763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/pytorch-training:2.5.1-gpu-py311",
          TrainingInputMode: "File",
        },
        RoleArn: process.env.ROLE_ARN!,
        OutputDataConfig: {
          S3OutputPath: `s3://${process.env.S3_BUCKET}/pipeline-inference/${broadcastId}/${channel}/`,
        },
        ResourceConfig: {
          InstanceType: inferenceInstanceType,
          InstanceCount: 1,
          VolumeSizeInGB: 100,
        },
        StoppingCondition: {
          MaxRuntimeInSeconds: 30 * 3600,
        },
        HyperParameters: {
          sagemaker_program: "main.py",
          sagemaker_submit_directory: `s3://${process.env.S3_BUCKET}/inference-scripts/sourcedir.tar.gz`,
        },
        Environment: {
          BROADCAST_ID: broadcastId,
          CHANNEL: channel.toLowerCase(),
          STREAM_REGION: region.toLowerCase(),
          DB_CONNECTION_STRING: process.env.DATABASE_URL!,
          AWS_REGION: process.env.AWS_REGION || "ap-southeast-2",
        },
      },
    })

    // Add cleanup step
    const lastStep = `integration-analysis-${channel}`

    steps.push({
      Name: `cleanup-broadcast-${channel}-${region}`,
      Type: "Training",
      DependsOn: [lastStep],
      Arguments: {
        AlgorithmSpecification: {
          TrainingImage:
            "763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/pytorch-training:2.0.0-gpu-py310",
          TrainingInputMode: "File",
        },
        RoleArn: process.env.ROLE_ARN!,
        OutputDataConfig: {
          S3OutputPath: `s3://${process.env.S3_BUCKET}/pipeline-cleanup/${broadcastId}/`,
        },
        ResourceConfig: {
          InstanceType: "ml.t3.large",
          InstanceCount: 1,
          VolumeSizeInGB: 30,
        },
        StoppingCondition: {
          MaxRuntimeInSeconds: 1800,
        },
        HyperParameters: {
          sagemaker_program: "main.py",
          sagemaker_submit_directory: `s3://${process.env.S3_BUCKET}/post-inference-script/sourcedir.tar.gz`,
        },
        Environment: {
          BROADCAST_ID: broadcastId,
          CHANNEL: channel.toLowerCase(),
          STREAM_REGION: region.toLowerCase(),
          AWS_REGION: process.env.AWS_REGION || "ap-southeast-2",
        },
      },
    })

    const pipelineDefinition = {
      Version: "2020-12-01",
      Metadata: {},
      Parameters: [
        {
          Name: "BroadcastId",
          Type: "String",
          DefaultValue: broadcastId,
        },
      ],
      PipelineExperimentConfig: {
        ExperimentName: `analysis-experiment-${broadcastId}`,
        TrialName: `analysis-trial-${Date.now()}`,
      },
      Steps: steps,
    }

    const pipelineName = `analysis-pipeline-${broadcastId}-${Date.now()}`

    // Create the pipeline
    const createPipelineCommand = new CreatePipelineCommand({
      PipelineName: pipelineName,
      PipelineDefinition: JSON.stringify(pipelineDefinition),
      PipelineDescription: `Analysis pipeline for broadcast ${broadcastId}`,
      RoleArn: process.env.ROLE_ARN!,
    })

    await sagemakerClient.send(createPipelineCommand)

    // Start pipeline execution
    const executionName = `execution-${broadcastId}-${Date.now()}`
    const startExecutionCommand = new StartPipelineExecutionCommand({
      PipelineName: pipelineName,
      PipelineExecutionDisplayName: executionName,
      PipelineParameters: [{ Name: "BroadcastId", Value: broadcastId }],
    })

    const executionResponse = await sagemakerClient.send(startExecutionCommand)

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        pipelineName,
        executionArn: executionResponse.PipelineExecutionArn,
        executionName,
        parallelDownloads: true,
      }),
    }
  } catch (error) {
    console.error("Error starting analysis pipeline:", error)
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    }
  }
}

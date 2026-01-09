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
  channel: string
  region: string
  programName: string
  dayId: string
  s3Key: string
  broadcast_date: string
  inferenceInstanceType?: string
}

export const handler = async (event: LambdaEvent) => {
  try {
    const {
      channel,
      region,
      programName,
      dayId,
      s3Key,
      broadcast_date,
      inferenceInstanceType = "ml.t3.large",
    } = event

    const steps: object[] = []

    if (
      !channel ||
      !region ||
      !programName ||
      !dayId ||
      !s3Key ||
      !broadcast_date
    ) {
      throw new Error("Missing required parameters in the event")
    }

    steps.push({
      Name: `billboard-analysis-${channel}-${region}`,
      Type: "Training",
      Arguments: {
        AlgorithmSpecification: {
          TrainingImage:
            "763104351884.dkr.ecr.ap-southeast-2.amazonaws.com/pytorch-training:2.0.0-gpu-py310",
          TrainingInputMode: "File",
        },
        RoleArn: process.env.ROLE_ARN!,
        OutputDataConfig: {
          S3OutputPath: `s3://${process.env.S3_BUCKET}/pipeline-inference/${channel}-${region}/`,
        },
        ResourceConfig: {
          InstanceType: inferenceInstanceType,
          InstanceCount: 1,
          VolumeSizeInGB: 100,
        },
        StoppingCondition: {
          MaxRuntimeInSeconds: 20 * 3600,
        },
        HyperParameters: {
          sagemaker_program: "main.py",
          sagemaker_submit_directory: `s3://${process.env.S3_BUCKET}/billboard-analysis-scripts/sourcedir.tar.gz`,
        },
        Environment: {
          CHANNEL: channel.toLowerCase(),
          STREAM_REGION: region.toLowerCase(),
          PROGRAM_NAME: programName,
          DAY_ID: dayId,
          LOG_S3_KEY: s3Key,
          BROADCAST_DATE: broadcast_date,
          DB_CONNECTION_STRING: process.env.DATABASE_URL!,
          AWS_REGION: process.env.AWS_REGION || "ap-southeast-2",
        },
      },
    })

    const pipelineDefinition = {
      Version: "2020-12-01",
      Metadata: {},
      Parameters: [],
      PipelineExperimentConfig: {
        ExperimentName: `analysis-experiment-${channel}-${region}`,
        TrialName: `analysis-trial-${Date.now()}`,
      },
      Steps: steps,
    }

    const pipelineName = `analysis-pipeline-${channel}-${region}-${Date.now()}`

    // Create the pipeline
    const createPipelineCommand = new CreatePipelineCommand({
      PipelineName: pipelineName,
      PipelineDefinition: JSON.stringify(pipelineDefinition),
      PipelineDescription: `Analysis pipeline for ${channel} in ${region}`,
      RoleArn: process.env.ROLE_ARN!,
    })

    await sagemakerClient.send(createPipelineCommand)

    // Start pipeline execution
    const executionName = `execution-${region}-${channel}-${Date.now()}`
    const startExecutionCommand = new StartPipelineExecutionCommand({
      PipelineName: pipelineName,
      PipelineExecutionDisplayName: executionName,
      PipelineParameters: [],
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

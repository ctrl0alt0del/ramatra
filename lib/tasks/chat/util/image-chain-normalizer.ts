type KnownImageWorkflow = "base" | "illustration" | "edit";

const extractWorkflowNameFromText = (
  input: string | null | undefined,
): KnownImageWorkflow | null => {
  if (!input) {
    return null;
  }
  const match = input.match(
    /\bselected\s+workflow\s*:\s*(base|illustration|edit)\b/i,
  );
  if (!match) {
    return null;
  }
  const workflow = (match[1] ?? "").toLowerCase();
  if (
    workflow === "base" ||
    workflow === "illustration" ||
    workflow === "edit"
  ) {
    return workflow;
  }
  return null;
};

export const normalizeUtilStageForImageChain = ({
  currentUtilTaskName,
  parsedStage,
  parsedContextText,
  currentSystemPromptExt,
  parsedPersistent,
}: {
  currentUtilTaskName: string;
  parsedStage: string;
  parsedContextText?: string;
  currentSystemPromptExt?: string;
  parsedPersistent?: boolean;
}):
  | {
      accepted: true;
      stage: string;
      persistent?: boolean;
      normalized: boolean;
      reason?: string;
    }
  | {
      accepted: false;
      reason: string;
    } => {
  if (!currentUtilTaskName.startsWith("img_gen_")) {
    return {
      accepted: true,
      stage: parsedStage,
      persistent: parsedPersistent,
      normalized: false,
    };
  }

  if (currentUtilTaskName === "img_gen_workflow") {
    if (parsedStage === "callback") {
      return {
        accepted: true,
        stage: parsedStage,
        persistent: parsedPersistent,
        normalized: false,
      };
    }
    if (parsedStage === "img_gen_loras") {
      return {
        accepted: true,
        stage: parsedStage,
        persistent: parsedPersistent,
        normalized: false,
      };
    }
    return {
      accepted: false,
      reason: `invalid transition ${currentUtilTaskName} -> ${parsedStage}`,
    };
  }

  if (currentUtilTaskName === "img_gen_loras") {
    if (parsedStage === "callback") {
      return {
        accepted: true,
        stage: parsedStage,
        persistent: parsedPersistent,
        normalized: false,
      };
    }
    if (/^img_gen_(base|illustration|edit)_finalize$/.test(parsedStage)) {
      return {
        accepted: true,
        stage: parsedStage,
        persistent: parsedPersistent,
        normalized: false,
      };
    }

    const workflow =
      extractWorkflowNameFromText(parsedContextText) ??
      extractWorkflowNameFromText(currentSystemPromptExt);

    if (workflow) {
      return {
        accepted: true,
        stage: `img_gen_${workflow}_finalize`,
        persistent: true,
        normalized: true,
        reason: `normalized from ${parsedStage} using workflow=${workflow}`,
      };
    }

    return {
      accepted: false,
      reason: `could not resolve finalize workflow for ${currentUtilTaskName} -> ${parsedStage}`,
    };
  }

  if (/^img_gen_(base|illustration|edit)_finalize$/.test(currentUtilTaskName)) {
    if (parsedStage === "callback") {
      return {
        accepted: true,
        stage: parsedStage,
        persistent: parsedPersistent,
        normalized: false,
      };
    }
    return {
      accepted: false,
      reason: `no next util stage expected after ${currentUtilTaskName}`,
    };
  }

  return {
    accepted: true,
    stage: parsedStage,
    persistent: parsedPersistent,
    normalized: false,
  };
};

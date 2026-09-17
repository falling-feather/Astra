import { describe, expect, it } from "vitest";
import {
  createAgentInstance,
  createAgentArchitectureProfile,
  createAgentTemplate,
  factCheckerAgentDefinition,
} from "../src/index.js";

describe("agent template and instance scale model", () => {
  it("pins one definition to a versioned template and a session-scoped instance", () => {
    const template = createAgentTemplate(factCheckerAgentDefinition);
    const instance = createAgentInstance({
      definition: factCheckerAgentDefinition,
      sessionId: "session-scale",
      sessionEpoch: "epoch-1",
      context: {
        bindingKind: "teacher_assistant",
        bindingId:
          "role-binding:course-converged-media-practice:fact_checker:agent-fact-checker",
        actorId: "agent-fact-checker",
        actorKind: "agent",
        courseId: "course-converged-media-practice",
        teamId: "team-editorial",
        privateMemoryNamespaceRef:
          "session:session-scale/epoch:epoch-1/team:team-editorial/actor:agent-fact-checker",
        configHash: "a".repeat(64),
        lifecycle: "active",
        subjectActorId: null,
        subjectRoleId: null,
        resourceRef: null,
      },
      createdAt: "2026-07-29T01:00:00.000Z",
    });

    expect(template).toMatchObject({
      templateId: "template:agent-fact-checker",
      templateVersion: "fact-checker/1.2.0",
      definitionVersion: "fact-checker/1.2.0",
      promptVersion: "1.2.0",
      roleId: "fact_checker",
      enabled: true,
    });
    expect(instance).toMatchObject({
      instanceRef: {
        instanceId: "session-scale:epoch-1:agent-fact-checker",
        instanceVersion: "fact-checker/1.2.0",
      },
      templateRef: {
        templateId: template.templateId,
        templateVersion: template.templateVersion,
      },
      context: {
        bindingKind: "teacher_assistant",
        lifecycle: "active",
      },
    });
    expect(template).toMatchObject({
      graphRef: "agent-graph:agent-fact-checker@fact-checker/1.2.0",
      allowedInstanceKinds: ["teacher_assistant"],
      permissionPolicyRef: "role-contract:fact_checker",
    });
    expect(createAgentArchitectureProfile({
      profileId: "architecture-standard",
      profileVersion: "1.0.0",
      enabledTemplateIds: null,
      disabledTemplateIds: [],
    }).policyHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

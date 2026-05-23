import type { ProblemDetailsDto } from "../domain/dto";

export const problemTypeBase = "https://janban.example/problems";

export class ProblemError extends Error {
  readonly problem: ProblemDetailsDto;

  constructor(problem: ProblemDetailsDto) {
    super(problem.detail ?? problem.title);
    this.name = "ProblemError";
    this.problem = problem;
  }
}

export function createProblem(input: {
  status: number;
  title: string;
  detail?: string;
  type?: string;
  instance?: string;
  requestId?: string;
  errors?: ProblemDetailsDto["errors"];
}): ProblemDetailsDto {
  return {
    type: input.type ?? `${problemTypeBase}/${slugify(input.title)}`,
    title: input.title,
    status: input.status,
    detail: input.detail,
    instance: input.instance,
    errors: input.errors,
    requestId: input.requestId,
  };
}

export function throwProblem(input: Parameters<typeof createProblem>[0]): never {
  throw new ProblemError(createProblem(input));
}

export function problemResponse(problem: ProblemDetailsDto, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      "content-type": "application/problem+json; charset=utf-8",
      "x-request-id": problem.requestId ?? "unknown",
      ...extraHeaders,
    },
  });
}

export function validationProblem(detail: string, pointer = "#"): ProblemDetailsDto {
  return createProblem({
    status: 422,
    title: "Validation error",
    detail,
    errors: [
      {
        pointer,
        detail,
        code: "validation_error",
      },
    ],
  });
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "error";
}

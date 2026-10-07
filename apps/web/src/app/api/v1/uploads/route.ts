import { z } from "zod";
import { route } from "@imo/server/http/route";
import { requestUpload, UPLOAD_PURPOSES, type UploadPurpose } from "@imo/server/usecases/uploads";

/** A ticket to upload one image straight to storage. */
export const POST = route({
  auth: "required",
  limit: "api:write",
  status: 201,
  body: z.object({
    purpose: z.enum(Object.keys(UPLOAD_PURPOSES) as [UploadPurpose, ...UploadPurpose[]]),
    contentType: z.string().max(100),
    bytes: z.number().int().positive(),
  }),
  handler: ({ deps, viewer, body }) => requestUpload(deps, viewer, body),
});

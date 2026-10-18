import { handleRequest } from '../../server/handler';

export default async function handler(request: Request): Promise<Response> {
  return handleRequest(request);
}

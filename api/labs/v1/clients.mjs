import { handleLabsRequest } from "../../../lib/labs-api.mjs";

export default {
  fetch(request) {
    return handleLabsRequest(request, "clients");
  },
};

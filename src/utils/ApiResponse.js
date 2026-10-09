/**
 * The single success envelope for every endpoint.
 *
 *   { success: true, statusCode: 200, message: "…", data: … }
 *
 * Controllers never call res.json() directly — they go through here, so the
 * shape stays identical across the whole API.
 *
 *   ApiResponse.ok(res, companies, 'Companies fetched successfully');
 *   ApiResponse.created(res, doc, 'Enquiry submitted successfully');
 */
class ApiResponse {
  constructor(statusCode = 200, data = null, message = 'Success') {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
  }

  send(res) {
    return res.status(this.statusCode).json(this);
  }

  /** 200 — the record(s) already existed. */
  static ok(res, data = null, message = 'Success') {
    return new ApiResponse(200, data, message).send(res);
  }

  /** 201 — something new was stored. */
  static created(res, data = null, message = 'Created successfully') {
    return new ApiResponse(201, data, message).send(res);
  }
}

module.exports = ApiResponse;

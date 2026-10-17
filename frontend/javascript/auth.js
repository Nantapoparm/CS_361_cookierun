/*
 *
 * โหลดในหน้า HTML (config.js ต้องมาก่อน auth.js):
 *   <script src="javascript/config.js"></script>
 *   <script src="javascript/auth.js"></script>
 *
 * Usage:
 *
 * // Login
 * try {
 *   const result = await Auth.login(username, password);
 *
 *   if (result.status === "authenticated") {
 *     console.log(result.userRole);
 *     console.log(result.groups);
 *     window.location.href = "./dashboard.html";
 *   }
 * } catch (error) {
 *   if (error.code === "INVALID_CREDENTIALS") {
 *     // A2: Invalid username or password
 *   } else if (error.code === "NO_GROUP") {
 *     // A3: ไม่มีสิทธิ์ใช้งาน
 *   } else if (error.code === "NEW_PASSWORD_REQUIRED") {
 *     // Contact administrator; no password-change UI in V3
 *   } else if (error.code === "AUTH_NETWORK_ERROR") {
 *     // เชื่อมต่อ Cognito ไม่ได้
 *   }
 * }
 *
 * // Get Access Token for backend API requests
 * const token = await Auth.getToken(); // string | null
 *
 * // Get user role for frontend UI
 * const role = Auth.getUserRole(); // string | null
 *
 * // Check whether the user has a usable session
 * const loggedIn = await Auth.isLoggedIn(); // boolean
 *
 * // Logout and clear stored tokens
 * await Auth.logout();
 *
 * Login result:
 *   { status: "authenticated", userRole, groups }
 *
 * Error codes:
 *   INVALID_CREDENTIALS
 *   NO_GROUP
 *   NEW_PASSWORD_REQUIRED
 *   LOGIN_INCOMPLETE
 *   AUTH_NETWORK_ERROR
 *
 * Token storage: localStorage
 */

(function () {
  "use strict";

  const storage = window.localStorage;
  const CONFIG = window.APP_CONFIG && window.APP_CONFIG.cognito;

  if (!CONFIG || !CONFIG.region || !CONFIG.clientId) {
    throw new Error(
      "Cognito configuration missing. Load config.js before auth.js."
    );
  }

  const ENDPOINT = `https://cognito-idp.${CONFIG.region}.amazonaws.com/`;

  const STORAGE_KEYS = {
    accessToken: "cognito_access_token",
    idToken: "cognito_id_token",
    refreshToken: "cognito_refresh_token"
  };

  const ALLOWED_ROLES = ["instructor", "ta", "student_helper", "admin"];

  let refreshPromise = null;

  // ------------------------------
  // Cognito API helper
  // ------------------------------

  async function cognitoRequest(action, payload) {
    let response;

    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`
        },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      const error = new Error("เชื่อมต่อระบบยืนยันตัวตนไม่ได้ กรุณาลองใหม่");
      error.code = "AUTH_NETWORK_ERROR";
      throw error;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const rawCode = data.__type || data.code || data.Code || "AUTH_ERROR";

      const error = new Error(
        data.message || data.Message || "Cognito request failed"
      );
      error.code = rawCode.split("#").pop().split(":")[0];
      throw error;
    }

    return data;
  }

  // ------------------------------
  // JWT helpers
  // ------------------------------

  // Decode JWT payload for frontend display only.
  // This does NOT verify the token signature.
  function decodePayload(token) {
    const parts = token && token.split(".");

    if (!parts || parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");

    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));

    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function isTokenExpired(token, bufferSeconds) {
    bufferSeconds = bufferSeconds || 0;
    try {
      const claims = decodePayload(token);

      return (
        typeof claims.exp !== "number" ||
        claims.exp <= Math.floor(Date.now() / 1000) + bufferSeconds
      );
    } catch (e) {
      return true;
    }
  }

  // ------------------------------
  // Token storage
  // ------------------------------

  function storeTokens(result) {
    if (!result || !result.AccessToken || !result.IdToken) {
      throw new Error("Cognito did not return both required tokens");
    }

    storage.setItem(STORAGE_KEYS.accessToken, result.AccessToken);
    storage.setItem(STORAGE_KEYS.idToken, result.IdToken);

    // Cognito may not return a new RefreshToken during refresh.
    if (result.RefreshToken) {
      storage.setItem(STORAGE_KEYS.refreshToken, result.RefreshToken);
    }
  }

  function clearTokens() {
    Object.values(STORAGE_KEYS).forEach((key) => {
      storage.removeItem(key);
    });

    refreshPromise = null;
  }

  // ------------------------------
  // Role helpers
  // ------------------------------

  function getGroupsFromIdToken() {
    const token = storage.getItem(STORAGE_KEYS.idToken);

    if (!token) {
      return [];
    }

    try {
      const claims = decodePayload(token);
      const groups = claims["cognito:groups"];

      return Array.isArray(groups)
        ? groups.filter((group) => ALLOWED_ROLES.includes(group))
        : [];
    } catch (e) {
      return [];
    }
  }

  function roleFromGroups(groups) {
    // Expected: one role group per user.
    const priority = ["admin", "instructor", "ta", "student_helper"];

    const found = priority.find((role) => groups.includes(role));
    return found === undefined ? null : found;
  }

  function makeAuthResult() {
    const groups = getGroupsFromIdToken();

    return {
      status: "authenticated",
      userRole: roleFromGroups(groups),
      groups: groups
    };
  }

  // ------------------------------
  // Login
  // ------------------------------

  async function login(username, password) {
    await logout();
    let data;

    try {
      data = await cognitoRequest("InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: CONFIG.clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password
        }
      });
    } catch (error) {
      if (
        error.code === "NotAuthorizedException" ||
        error.code === "UserNotFoundException"
      ) {
        const authError = new Error("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
        authError.code = "INVALID_CREDENTIALS";
        throw authError;
      }

      throw error;
    }

    if (data.ChallengeName === "NEW_PASSWORD_REQUIRED") {
      const error = new Error(
        "บัญชีนี้ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน กรุณาติดต่อผู้ดูแลระบบ"
      );
      error.code = "NEW_PASSWORD_REQUIRED";
      throw error;
    }

    if (!data.AuthenticationResult) {
      const error = new Error("ไม่สามารถเข้าสู่ระบบได้");
      error.code = "LOGIN_INCOMPLETE";
      throw error;
    }

    storeTokens(data.AuthenticationResult);

    const result = makeAuthResult();

    if (!result.userRole) {
      clearTokens();

      const error = new Error("ไม่มีสิทธิ์ใช้งาน");
      error.code = "NO_GROUP";
      throw error;
    }

    return result;
  }

  // ------------------------------
  // Refresh tokens
  // ------------------------------

  async function doRefresh() {
    const refreshToken = storage.getItem(STORAGE_KEYS.refreshToken);

    if (!refreshToken) {
      clearTokens();
      return null;
    }

    try {
      const data = await cognitoRequest("InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: CONFIG.clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken }
      });

      const result = data.AuthenticationResult;

      if (!result || !result.AccessToken) {
        clearTokens();
        return null;
      }

      storeTokens(
        Object.assign({}, result, {
          RefreshToken: result.RefreshToken || refreshToken
        })
      );

      return result.AccessToken;
    } catch (error) {
      if (error.code === "AUTH_NETWORK_ERROR") throw error;
      clearTokens();
      return null;
    }
  }

  function refreshTokens() {
    if (!refreshPromise) {
      refreshPromise = doRefresh().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  // ------------------------------
  // Public API
  // ------------------------------

  async function getToken() {
    const token = storage.getItem(STORAGE_KEYS.accessToken);

    if (!token) {
      return null;
    }

    // Refresh 60 seconds before token expiry.
    if (isTokenExpired(token, 60)) {
      return await refreshTokens();
    }

    return token;
  }

  function getUserRole() {
    return roleFromGroups(getGroupsFromIdToken());
  }

  async function isLoggedIn() {
    return (await getToken()) !== null;
  }

  async function logout() {
    const refreshToken = storage.getItem(STORAGE_KEYS.refreshToken);

    clearTokens();

    if (!refreshToken) return;

    try {
      await cognitoRequest("RevokeToken", {
        ClientId: CONFIG.clientId,
        Token: refreshToken
      });
    } catch (error) {
      console.error("Cognito revoke failed:", error.message);
    }
  }

  window.Auth = { login, getToken, getUserRole, isLoggedIn, logout };
})();
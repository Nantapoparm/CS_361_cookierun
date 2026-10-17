
from db import run_auth, ok
from validation import role_key, session_name


def lambda_handler(event, context):
    return run_auth(event, lambda conn, auth: _rates(conn))


def _rates(conn):
    with conn.cursor() as cur:
        cur.execute(
            """SELECT r.roleName, cr.compensationPerHour, rl.maxHoursPerTerm
               FROM compensation_rates cr
               JOIN `session` s ON s.sessionId = cr.sessionId AND s.sessionName = %s
               JOIN user_role r ON r.roleId = cr.roleId
               LEFT JOIN compensation_rules rl
                      ON rl.sessionId = cr.sessionId AND rl.roleId = cr.roleId
               ORDER BY cr.roleId""",
            (session_name(),),
        )
        rows = cur.fetchall()

    return ok(
        200,
        [
            {
                "role": role_key(r["roleName"]),
                "ratePerHour": float(r["compensationPerHour"]) if r["compensationPerHour"] is not None else 0,
                "maxHours": float(r["maxHoursPerTerm"]) if r["maxHoursPerTerm"] is not None else None,
                "maxHoursHalfLoad": None,
            }
            for r in rows
        ],
    )
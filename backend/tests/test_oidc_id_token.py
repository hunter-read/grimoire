"""ID-token verification against real signed tokens (issue #789).

``test_oidc.py`` fakes the decode step to test what happens around it. These
sign real tokens with joserfc and run them through ``_validate_id_token``
unchanged, so each security check - signature, pinned algorithm, issuer,
audience, expiry, nonce, azp, key rotation - is exercised by a token that
fails it. Only the JWKS fetch is patched.
"""
import base64
import hashlib
import hmac
import json
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import patch

import pytest
from joserfc import jwt
from joserfc.jwk import ECKey, KeySet, OctKey, RSAKey

from backend.routers.oidc import _helpers
from backend.routers.oidc._helpers import _OIDCError

# The repo root, where `backend` imports from whatever directory pytest started in.
_REPO = str(Path(__file__).resolve().parents[2])

ISSUER = "https://idp.test/realm"
CLIENT = "grimoire"
NONCE = "nonce-1"

KEY_A = RSAKey.generate_key(2048, parameters={"kid": "a", "use": "sig"})
KEY_B = RSAKey.generate_key(2048, parameters={"kid": "b", "use": "sig"})


def _jwks(*keys):
    return KeySet(list(keys)).as_dict(private=False)


def _claims(**over):
    now = int(time.time())
    claims = {"iss": ISSUER, "aud": CLIENT, "sub": "user-1", "nonce": NONCE,
              "iat": now, "exp": now + 300}
    claims.update(over)
    return {k: v for k, v in claims.items() if v is not None}


def _sign(claims, key=KEY_A, alg="RS256", **header):
    return jwt.encode({"alg": alg, "kid": key.kid, **header}, claims, key, algorithms=[alg])


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _validate(token, jwks=None, refreshed=None, alg="RS256"):
    """Run the real validation; ``refreshed`` is what a forced JWKS fetch returns."""
    cached = jwks if jwks is not None else _jwks(KEY_A)

    def get_jwks(_uri, force=False):
        return refreshed if force and refreshed is not None else cached

    with patch.object(_helpers, "_get_jwks", side_effect=get_jwks) as fetch:
        result = _helpers._validate_id_token(
            token,
            issuer=ISSUER,
            client_id=CLIENT,
            jwks_uri="https://idp.test/jwks",
            expected_nonce=NONCE,
            allowed_alg=alg,
        )
    return result, fetch


class TestAccepted:
    def test_a_valid_token(self):
        claims, _ = _validate(_sign(_claims()))
        assert claims["sub"] == "user-1"
        assert isinstance(claims, dict)

    def test_expired_within_the_leeway(self):
        claims, _ = _validate(_sign(_claims(exp=int(time.time()) - 10)))
        assert claims["sub"] == "user-1"

    def test_one_of_several_audiences_with_azp_naming_us(self):
        claims, _ = _validate(_sign(_claims(aud=[CLIENT, "other"], azp=CLIENT)))
        assert claims["azp"] == CLIENT

    def test_a_lone_key_when_the_token_names_none(self):
        token = jwt.encode({"alg": "RS256"}, _claims(), KEY_A, algorithms=["RS256"])
        claims, _ = _validate(token)
        assert claims["sub"] == "user-1"

    def test_keys_of_a_type_it_cannot_read_are_skipped(self):
        jwks = _jwks(KEY_A)
        jwks["keys"].insert(0, {"kty": "ML-DSA", "kid": "pq", "pub": "AAAA"})
        claims, _ = _validate(_sign(_claims()), jwks=jwks)
        assert claims["sub"] == "user-1"

    @pytest.mark.parametrize(
        "alg,key",
        [
            ("PS256", RSAKey.generate_key(2048, parameters={"kid": "ps"})),
            ("ES384", ECKey.generate_key("P-384", parameters={"kid": "ec"})),
        ],
    )
    def test_other_configured_algorithms(self, alg, key):
        # Neither is in joserfc's default "recommended" set; naming the
        # configured algorithm is what allows them.
        claims, _ = _validate(_sign(_claims(), key=key, alg=alg), jwks=_jwks(key), alg=alg)
        assert claims["sub"] == "user-1"

    def test_a_rotated_key_after_one_forced_refresh(self):
        claims, fetch = _validate(
            _sign(_claims(), key=KEY_B), jwks=_jwks(KEY_A), refreshed=_jwks(KEY_B)
        )
        assert claims["sub"] == "user-1"
        assert [c.kwargs.get("force", False) for c in fetch.call_args_list] == [False, True]


class TestRefused:
    def _refused(self, token, match, **kwargs):
        with pytest.raises(_OIDCError, match=match):
            _validate(token, **kwargs)

    def test_wrong_issuer(self):
        self._refused(_sign(_claims(iss="https://evil.test")), "claims invalid")

    def test_wrong_audience(self):
        self._refused(_sign(_claims(aud="someone-else")), "claims invalid")

    def test_expired_beyond_the_leeway(self):
        self._refused(_sign(_claims(exp=int(time.time()) - 120)), "claims invalid")

    def test_issued_in_the_future_beyond_the_leeway(self):
        self._refused(_sign(_claims(iat=int(time.time()) + 600)), "claims invalid")

    @pytest.mark.parametrize("claim", ["iss", "aud", "exp"])
    def test_a_missing_essential_claim(self, claim):
        self._refused(_sign(_claims(**{claim: None})), "claims invalid")

    def test_wrong_nonce(self):
        self._refused(_sign(_claims(nonce="replayed")), "nonce mismatch")

    def test_several_audiences_without_azp(self):
        self._refused(_sign(_claims(aud=[CLIENT, "other"])), "azp")

    def test_an_unsigned_token(self):
        token = f"{_b64(json.dumps({'alg': 'none'}).encode())}.{_b64(json.dumps(_claims()).encode())}."
        self._refused(token, "signature invalid")

    def test_hs256_with_a_shared_secret(self):
        secret = OctKey.import_key("a-shared-secret-of-thirty-two-b!")
        token = jwt.encode({"alg": "HS256", "kid": "a"}, _claims(), secret, algorithms=["HS256"])
        self._refused(token, "signature invalid")

    def test_hs256_keyed_with_the_providers_public_key(self):
        """The classic confusion: HMAC with the public RSA key as the secret."""
        public_pem = KEY_A.as_pem(private=False)
        signing_input = (
            f"{_b64(json.dumps({'alg': 'HS256', 'kid': 'a'}).encode())}."
            f"{_b64(json.dumps(_claims()).encode())}"
        )
        mac = hmac.new(public_pem, signing_input.encode(), hashlib.sha256).digest()
        self._refused(f"{signing_input}.{_b64(mac)}", "signature invalid")

    def test_another_algorithm_from_the_right_key(self):
        """Pinned to RS256: a valid RS512 signature by the same key is refused."""
        self._refused(_sign(_claims(), alg="RS512"), "signature invalid")

    def test_a_key_the_provider_never_published(self):
        stranger = RSAKey.generate_key(2048, parameters={"kid": "a"})
        self._refused(_sign(_claims(), key=stranger), "signature invalid")

    def test_a_tampered_payload(self):
        header, _payload, signature = _sign(_claims()).split(".")
        forged = _b64(json.dumps(_claims(sub="admin")).encode())
        self._refused(f"{header}.{forged}.{signature}", "signature invalid")

    @pytest.mark.parametrize("jwks", [{}, {"keys": []}, {"keys": [{"kty": "RSA"}]}])
    def test_an_unusable_key_set(self, jwks):
        self._refused(_sign(_claims()), "signature invalid", jwks=jwks)

    def test_a_rotated_key_that_never_appears(self):
        self._refused(
            _sign(_claims(), key=KEY_B), "signature invalid", jwks=_jwks(KEY_A), refreshed=_jwks(KEY_A)
        )


def test_importing_the_app_prints_no_authlib_warning():
    """authlib.jose warned on import, past any warnings filter (issue #789)."""
    out = subprocess.run(
        [sys.executable, "-c", "import backend.main"],
        cwd=_REPO,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert out.returncode == 0, out.stderr
    assert "authlib" not in (out.stdout + out.stderr).lower()

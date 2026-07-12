import Capacitor
import GoogleSignIn

@objc(GoogleAuthPlugin)
public class GoogleAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "GoogleAuthPlugin"
    public let jsName = "GoogleAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
    ]

    @objc func signIn(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller is available for Google sign-in.")
                return
            }
            guard let clientId = self.clientId(from: call) else {
                call.reject("Missing iOS OAuth Client ID. Set GOOGLE_IOS_CLIENT_ID and GOOGLE_IOS_REVERSED_CLIENT_ID in the App target build settings.")
                return
            }

            GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientId)
            let scopes = call.getArray("scopes", String.self) ?? []

            if let user = GIDSignIn.sharedInstance.currentUser {
                self.ensureScopes(user: user, scopes: scopes, presenter: presenter, call: call)
                return
            }

            GIDSignIn.sharedInstance.restorePreviousSignIn { user, _ in
                if let user = user {
                    self.ensureScopes(user: user, scopes: scopes, presenter: presenter, call: call)
                    return
                }

                GIDSignIn.sharedInstance.signIn(withPresenting: presenter) { result, error in
                    if let error = error {
                        call.reject(error.localizedDescription)
                        return
                    }
                    guard let user = result?.user else {
                        call.reject("Google sign-in did not return a user.")
                        return
                    }
                    self.ensureScopes(user: user, scopes: scopes, presenter: presenter, call: call)
                }
            }
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        GIDSignIn.sharedInstance.signOut()
        call.resolve()
    }

    private func clientId(from call: CAPPluginCall) -> String? {
        if let id = call.getString("clientId"), isConfigured(id) {
            return id
        }
        if let id = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String, isConfigured(id) {
            return id
        }
        return nil
    }

    private func isConfigured(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return !trimmed.isEmpty && !trimmed.contains("$(")
    }

    private func ensureScopes(
        user: GIDGoogleUser,
        scopes: [String],
        presenter: UIViewController,
        call: CAPPluginCall
    ) {
        let granted = Set(user.grantedScopes ?? [])
        let missing = scopes.filter { !granted.contains($0) }

        guard !missing.isEmpty else {
            resolveWithFreshToken(user: user, call: call)
            return
        }

        user.addScopes(missing, presenting: presenter) { result, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            guard let scopedUser = result?.user else {
                call.reject("Google did not grant the requested Calendar scopes.")
                return
            }
            self.resolveWithFreshToken(user: scopedUser, call: call)
        }
    }

    private func resolveWithFreshToken(user: GIDGoogleUser, call: CAPPluginCall) {
        user.refreshTokensIfNeeded { refreshedUser, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            guard let fresh = refreshedUser else {
                call.reject("Google sign-in could not refresh the access token.")
                return
            }

            var payload: [String: Any] = [
                "accessToken": fresh.accessToken.tokenString,
                "grantedScopes": fresh.grantedScopes ?? [],
            ]
            if let expirationDate = fresh.accessToken.expirationDate {
                payload["expiresAt"] = Int(expirationDate.timeIntervalSince1970 * 1000)
            }
            if let profile = fresh.profile {
                payload["email"] = profile.email
                payload["name"] = profile.name
            }
            call.resolve(payload)
        }
    }
}

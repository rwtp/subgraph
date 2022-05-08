

# Making changes and updates
If the underlying contract changes you can update that by bumping the `rwtp` version in the `package.json`. 
This will update the links and you can run `graph codegen` to regenerate the bindings

# Important notes
This implementation does not work on studio, since studio does not support ipfs, but hosted does.

# Adding a new graph network
Create a hosted graph solution. (choose your network)

Change your network in the `subgraph.yaml` from rinkeby -> other network

run
`graph deploy --node https://api.thegraph.com/deploy/ <subgraph-name>`


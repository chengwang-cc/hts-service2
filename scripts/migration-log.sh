#!/bin/bash
export AWS_PROFILE=chitchats_dev
export KUBECONFIG="/Users/cheng/projects/cc/kubeconfig_chitchats-production-cluster"

# Infinite loop to keep checking pods and logs
while true; do
    echo "Checking for pods at $(date)..."

    # Get the pod name that matches the pattern api-dbmigrate-*
    POD_NAME=$(kubectl get pods --no-headers -o custom-columns=":metadata.name" -n staging | grep "dbmigrate-")

    # Check if any pod was found
    if [ -z "$POD_NAME" ]; then
        echo "No pod found with name starting with 'api-dbmigrate-'"
    else
        # If multiple pods match, process each one
        echo "Found pod(s):"
        echo "$POD_NAME"

        # Loop through each matching pod
        while IFS= read -r pod; do
            echo "------------------------------------"
            echo "Fetching logs for $pod..."
            kubectl logs "$pod" -n staging

            # Check the exit status of the logs command
            if [ $? -eq 0 ]; then
                echo "Logs retrieved successfully for $pod"
            else
                echo "Error retrieving logs for $pod"
            fi
            echo "------------------------------------"
        done <<< "$POD_NAME"
    fi

    echo "Waiting 5 seconds before next check..."
    sleep 5
done